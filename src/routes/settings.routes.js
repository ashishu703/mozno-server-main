import express from "express";
import { getPublicSettings } from "../controllers/faq.controller.js";

const router = express.Router();

// Public endpoint used by main frontend:
// GET /api/settings/public
router.get("/public", getPublicSettings);

export default router;

