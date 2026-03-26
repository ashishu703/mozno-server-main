import { Schema, model } from "mongoose";

const siteSettingsSchema = new Schema(
  {
    // General SEO
    siteTitle: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    siteDescription: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },

    // Branding
    logo: {
      type: String, // URL or file path
      default: "",
    },
    favicon: {
      type: String, // URL or file path
      default: "",
    },

    // Analytics
    googleAnalyticsId: {
      type: String,
      default: "",
      trim: true,
    },

    // Social Media
    socialLinks: {
      facebook: { type: String, default: "" },
      twitter: { type: String, default: "" },
      instagram: { type: String, default: "" },
      linkedin: { type: String, default: "" },
    },
  },
  { timestamps: true },
);

const SiteSettings = model("SiteSettings", siteSettingsSchema);
export default SiteSettings;
