import crypto from "crypto";
import Admin from "../models/admin.model.js";
import sendMail from "../utils/mailer.js";
import jwt from "jsonwebtoken";
import redis from "../configs/redis.js";

// ==================== AUTH CONTROLLERS ====================

export const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const admin = await Admin.findOne({ email: email.toLowerCase() });
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    if (admin.status === "inactive") {
      return res.status(401).json({
        success: false,
        message: "Your account has been deactivated. Please contact administrator.",
      });
    }

    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const token = jwt.sign(
      { id: admin._id, role: admin.role },
      process.env.SECRET_KEY,
      { expiresIn: "24h" }
    );

    // Update last login
    admin.lastLogin = new Date();
    await admin.save();

    return res.status(200).json({
      success: true,
      token,
      data: {
        id: admin._id,
        firstName: admin.firstName,
        lastName: admin.lastName,
        email: admin.email,
        role: admin.role,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const sendOtp = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const admin = await Admin.findOne({ email: email.toLowerCase() });
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Invalid Email Id",
      });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    // Store in Redis with expiration (5 minutes = 300 seconds)
    await redis.set(`admin_otp:${email.toLowerCase()}`, hashedOtp, "EX", 300);

    // Send the OTP via email
    await sendMail({
      to: email,
      subject: "Your 2FA Verification Code",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Two-Factor Authentication</h2>
          <p>Your verification code is:</p>
          <div style="background: #f4f4f4; padding: 20px; text-align: center; margin: 20px 0;">
            <h1 style="color: #000; letter-spacing: 10px; font-size: 32px;">${otp}</h1>
          </div>
          <p>This code will expire in 5 minutes.</p>
          <p>If you didn't request this code, please ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #666; font-size: 12px;">Security Team</p>
        </div>
      `,
    });

    return res.status(200).json({
      success: true,
      message: "OTP sent to email",
    });
  } catch (error) {
    console.error("Send OTP error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to send OTP",
    });
  }
};

export const verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP are required",
      });
    }

    const cachedOtp = await redis.get(`admin_otp:${email.toLowerCase()}`);
    if (!cachedOtp) {
      return res.status(400).json({
        success: false,
        message: "OTP expired or not found. Please request again.",
      });
    }

    const hashedInput = crypto.createHash("sha256").update(otp).digest("hex");

    if (hashedInput !== cachedOtp) {
      return res.status(401).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    // OTP is valid, generate JWT
    const admin = await Admin.findOne({ email: email.toLowerCase() });
    
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found",
      });
    }

    const token = jwt.sign(
      { id: admin._id, role: admin.role },
      process.env.SECRET_KEY,
      { expiresIn: "24h" }
    );

    // Update last login
    admin.lastLogin = new Date();
    await admin.save();

    // Delete OTP from Redis
    await redis.del(`admin_otp:${email.toLowerCase()}`);

    return res.status(200).json({
      success: true,
      token,
      data: {
        id: admin._id,
        firstName: admin.firstName,
        lastName: admin.lastName,
        email: admin.email,
        role: admin.role,
      },
    });
  } catch (error) {
    console.error("Verify OTP error:", error);
    return res.status(500).json({
      success: false,
      message: "OTP verification failed",
    });
  }
};

// ==================== PROFILE CONTROLLERS ====================

export const getAdminDetails = async (req, res) => {
  try {
    const adminId = req.user?.id;

    if (!adminId) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated",
      });
    }

    const admin = await Admin.findById(adminId).select("-password");

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: admin,
    });
  } catch (error) {
    console.error("Get admin details error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// ==================== ADMIN CRUD CONTROLLERS ====================

export const getAllAdmins = async (req, res) => {
  try {
    const { search, status, role, page = 1, limit = 50 } = req.query;

    const filter = {};

    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    if (status && status !== "all") {
      filter.status = status;
    }

    if (role && role !== "all") {
      filter.role = role;
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, parseInt(limit));
    const skip = (pageNum - 1) * limitNum;

    const [admins, total] = await Promise.all([
      Admin.find(filter)
        .select("-password")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Admin.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      count: admins.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      data: admins,
    });
  } catch (error) {
    console.error("Get all admins error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch admins",
    });
  }
};

export const getAdmin = async (req, res) => {
  try {
    const admin = await Admin.findById(req.params.id).select("-password");

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found",
      });
    }

    res.status(200).json({
      success: true,
      data: admin,
    });
  } catch (error) {
    console.error("Get admin error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch admin",
    });
  }
};

export const createAdmin = async (req, res) => {
  try {
    const { firstName, lastName, email, phone, password, role } = req.body;

    // Validate required fields
    if (!firstName || !firstName.trim()) {
      return res.status(400).json({
        success: false,
        message: "First name is required",
        field: "firstName",
      });
    }

    if (!email || !email.trim()) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
        field: "email",
      });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
        field: "password",
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
        field: "email",
      });
    }

    // Check if email already exists
    const existingAdmin = await Admin.findOne({ email: email.toLowerCase() });
    if (existingAdmin) {
      return res.status(400).json({
        success: false,
        message: "Email already registered",
        field: "email",
      });
    }

    // Create admin
    const admin = await Admin.create({
      firstName: firstName.trim(),
      lastName: lastName?.trim() || "",
      email: email.toLowerCase().trim(),
      phone: phone?.trim() || "",
      password,
      role: role || "admin",
      status: "active",
    });

    // Send welcome email (don't await, fire and forget)
    sendMail({
      to: email,
      subject: "Your Admin Account Has Been Created",
      html: `
        <h2>Welcome to Admin Panel</h2>
        <p>Your admin account has been created. Here are your login credentials:</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Password:</strong> ${password}</p>
        <p>Please change your password after first login.</p>
        <p><a href="${process.env.ADMIN_URL || "http://localhost:5173"}/login">Login Here</a></p>
      `,
    }).catch(err => console.error("Failed to send welcome email:", err));

    // Remove password from response
    const adminResponse = admin.toObject();
    delete adminResponse.password;

    res.status(201).json({
      success: true,
      message: "Admin created successfully",
      data: adminResponse,
    });
  } catch (error) {
    console.error("Create admin error:", error);

    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Email already exists",
        field: "email",
      });
    }

    res.status(500).json({
      success: false,
      message: error.message || "Failed to create admin",
    });
  }
};

export const updateAdmin = async (req, res) => {
  try {
    const { firstName, lastName, email, phone, role, status } = req.body;

    const admin = await Admin.findById(req.params.id);

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found",
      });
    }

    // Check if email is being changed and already exists
    if (email && email.toLowerCase() !== admin.email) {
      const existingAdmin = await Admin.findOne({ email: email.toLowerCase() });
      if (existingAdmin) {
        return res.status(400).json({
          success: false,
          message: "Email already in use",
          field: "email",
        });
      }
      admin.email = email.toLowerCase().trim();
    }

    // Update fields
    if (firstName) admin.firstName = firstName.trim();
    if (lastName !== undefined) admin.lastName = lastName.trim();
    if (phone !== undefined) admin.phone = phone.trim();
    if (role) admin.role = role;
    if (status) admin.status = status;

    await admin.save();

    // Remove password from response
    const adminResponse = admin.toObject();
    delete adminResponse.password;

    res.status(200).json({
      success: true,
      message: "Admin updated successfully",
      data: adminResponse,
    });
  } catch (error) {
    console.error("Update admin error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to update admin",
    });
  }
};

export const deleteAdmin = async (req, res) => {
  try {
    const admin = await Admin.findById(req.params.id);

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found",
      });
    }

    // Prevent deleting yourself
    if (admin._id.toString() === req.user?.id?.toString()) {
      return res.status(400).json({
        success: false,
        message: "You cannot delete yourself",
      });
    }

    await admin.deleteOne();

    res.status(200).json({
      success: true,
      message: "Admin deleted successfully",
    });
  } catch (error) {
    console.error("Delete admin error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to delete admin",
    });
  }
};

export const toggleAdminStatus = async (req, res) => {
  try {
    const admin = await Admin.findById(req.params.id);

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found",
      });
    }

    // Prevent deactivating yourself
    if (admin._id.toString() === req.user?.id?.toString()) {
      return res.status(400).json({
        success: false,
        message: "You cannot change your own status",
      });
    }

    admin.status = admin.status === "active" ? "inactive" : "active";
    await admin.save();

    const adminResponse = admin.toObject();
    delete adminResponse.password;

    res.status(200).json({
      success: true,
      message: `Admin ${admin.status === "active" ? "activated" : "deactivated"} successfully`,
      data: adminResponse,
    });
  } catch (error) {
    console.error("Toggle admin status error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to toggle admin status",
    });
  }
};

export const resetAdminPassword = async (req, res) => {
  try {
    const admin = await Admin.findById(req.params.id);

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found",
      });
    }

    // Generate random password
    const newPassword = crypto.randomBytes(8).toString("hex");

    // Update password
    admin.password = newPassword;
    await admin.save();

    // Send email with new password
    await sendMail({
      to: admin.email,
      subject: "Your Password Has Been Reset",
      html: `
        <h2>Password Reset</h2>
        <p>Your password has been reset by an administrator.</p>
        <p><strong>New Password:</strong> ${newPassword}</p>
        <p>Please change your password after logging in.</p>
        <p><a href="${process.env.ADMIN_URL || "http://localhost:5173"}/login">Login Here</a></p>
      `,
    });

    res.status(200).json({
      success: true,
      message: "Password reset email sent successfully",
    });
  } catch (error) {
    console.error("Reset admin password error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to reset password",
    });
  }
};

export const getAdminStats = async (req, res) => {
  try {
    const [total, active, inactive, recentLogins] = await Promise.all([
      Admin.countDocuments(),
      Admin.countDocuments({ status: "active" }),
      Admin.countDocuments({ status: "inactive" }),
      Admin.find({ lastLogin: { $ne: null } })
        .sort({ lastLogin: -1 })
        .limit(5)
        .select("firstName lastName email lastLogin avatar"),
    ]);

    res.status(200).json({
      success: true,
      data: {
        total,
        active,
        inactive,
        recentLogins,
      },
    });
  } catch (error) {
    console.error("Get admin stats error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch stats",
    });
  }
};

export const getMe = async (req, res) => {
  return getAdminDetails(req, res);
};

export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Please provide current and new password",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 6 characters",
      });
    }

    const admin = await Admin.findById(req.user.id);

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found",
      });
    }

    // Check current password
    const isMatch = await admin.comparePassword(currentPassword);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    // Update password
    admin.password = newPassword;
    await admin.save();

    res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to change password",
    });
  }
};
