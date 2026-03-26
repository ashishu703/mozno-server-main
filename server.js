import express from "express";
import { config } from "dotenv";
import db from "./src/configs/db.js";
import adminRouter from "./src/routes/admin.route.js";
import cors from "cors";
import DashRouter from "./src/routes/dashboard.route.js";
import blogRouter from "./src/routes/blog.route.js";
import careerRouter from "./src/routes/career.route.js";
import contactRoute from "./src/routes/contact.routes.js";
import router from "./src/routes/analyticsRoutes.js";
import './src/workers/mailService.js'
import testimonialRouter from "./src/routes/testimonials.routes.js";
import seoRouter from "./src/routes/seo.routes.js";
import marketRouter from "./src/routes/market.routes.js";
import settingsRouter from "./src/routes/settings.routes.js";
import { refreshMarketCache } from "./src/controllers/market.controller.js";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import redis from "./src/configs/redis.js";
import cron from "node-cron";


config();
// Development fallback: the repo .env currently doesn't include SECRET_KEY,
// but JWT is required for admin/auth/OTP flows.
if (!process.env.SECRET_KEY) {
  process.env.SECRET_KEY = "dev-secret-key";
}
db();

const app = express();

const allowedOrigins = [
  "http://localhost:5173", // Vite default
  "http://localhost:5174", // Vite alternate
  "http://localhost:3000", // If you ever run on 3000
  "http://127.0.0.1:5173",
  "https://2ae9-2409-40c4-21d4-7cf3-6598-76a5-69da-8b70.ngrok-free.app",
  "https://monzo-wealth-admin.vercel.app",
  "https://mozno-wealth-main.vercel.app",
  "https://mozno-wealth-admin-main.vercel.app"
  // Add your production domains here
  // "https://your-production-domain.com",
  // "https://admin.your-production-domain.com",
];

// Security middlewares
app.use(helmet());

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, etc)
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.log("CORS blocked origin:", origin); // Add this for debugging
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);

// Rate limiting (only if redis is configured)
let limiter;
try {
  if (redis && redis.status === 'ready') {
    limiter = rateLimit({
      store: new RedisStore({
        sendCommand: (...args) => redis.call(...args),
      }),
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // Limit each IP to 100 requests per windowMs
      standardHeaders: true,
      legacyHeaders: false,
      message: 'Too many requests from this IP, please try again later.',
    });
    console.log('✅ Rate limiting with Redis enabled');
  } else {
    // Fallback to memory store if Redis is not available
    limiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
      message: 'Too many requests from this IP, please try again later.',
    });
    console.log('⚠️ Rate limiting with memory store enabled (Redis not available)');
  }
} catch (error) {
  console.error('Error setting up rate limiter:', error.message);
  // Fallback rate limiter
  limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  });
}

// Apply rate limiter to all routes
app.use(limiter);

// Body parser middlewares
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

// Cron job to keep the server alive (only in production)
if (process.env.NODE_ENV === 'production') {
  cron.schedule("*/14 * * * *", async () => {
    try {
      console.log("⏱️ Cron running - keeping server alive");
      
      // Get the base URL from environment or construct from request
      const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
      
      const res = await fetch(`${baseUrl}/api/ping`);
      const text = await res.text();
      
      console.log("Ping response:", text);
    } catch (err) {
      console.error("Cron error:", err.message);
    }
  });
  console.log('⏰ Cron job scheduled for server keep-alive');
}

// Market data cron: refresh every 1 hour
cron.schedule("0 * * * *", async () => {
  try {
    await refreshMarketCache();
    console.log("📈 Market cache refreshed (hourly cron)");
  } catch (err) {
    console.error("Market cron error:", err.message);
  }
});
refreshMarketCache().catch((err) => {
  console.error("Initial market cache refresh failed:", err.message);
});

// Ping endpoint for health checks
app.get("/api/ping", (req, res) => {
  res.status(200).send("PONG");
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    redis: redis?.status || 'not connected'
  });
});


// Admin routes
app.use("/api/admin", adminRouter);
app.use("/api/admin/dashboard", DashRouter);

// Public routes
app.use("/api/blogs", blogRouter);
app.use("/api/career", careerRouter);
app.use("/api/contact", contactRoute);
app.use("/api/analytics", router);
app.use("/api/testimonials", testimonialRouter);
app.use("/api/seo", seoRouter);
app.use("/api/market", marketRouter);
app.use("/api/settings", settingsRouter);

// 404 handler for undefined routes
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    message: `Route ${req.method} ${req.url} not found` 
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  
  // Handle CORS errors specifically
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      success: false,
      message: 'CORS error: Origin not allowed'
    });
  }
  
  // Handle rate limit errors
  if (err.statusCode === 429) {
    return res.status(429).json({
      success: false,
      message: err.message || 'Too many requests'
    });
  }
  
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📡 Allowed origins: ${allowedOrigins.join(', ')}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  if (redis) {
    redis.quit();
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  if (redis) {
    redis.quit();
  }
  process.exit(0);
});
