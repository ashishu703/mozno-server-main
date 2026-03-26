import { contactSchema } from "../validator/user.schema.js";
import emailQueue from "../queues/email.queue.js";
import redis from "../configs/redis.js";
import User from "../models/user.model.js";

const EMAIL_DEDUPE_TTL = 60 * 5; // 5 minutes

export const contactForm = async (req, res) => {
  try {
    const validatedData = contactSchema.parse(req.body);
    const country = req.headers["x-vercel-ip-country"] || "Unknown";

    const { email, service, fullName, phone, company, message } = validatedData;

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedService = service.trim();

    // Use lean() for better performance on find
    let contact = await User.findOne({
      email: normalizedEmail,
      service: normalizedService,
    }).lean(); // Optional: converts to plain JS object

    let isNewContact = false;

    if (contact) {
      // Update existing contact - use findOneAndUpdate for atomic operation
      contact = await User.findOneAndUpdate(
        { 
          email: normalizedEmail, 
          service: normalizedService 
        },
        {
          fullName: fullName.trim(),
          phone: phone.trim(),
          company: company?.trim() || null,
          message: message.trim(),
          status: "new",
          emailStatus: "pending",
          country: country,
        },
        { new: true } // Return updated document
      );
    } else {
      // Create new contact
      isNewContact = true;
      contact = await User.create({
        fullName: fullName.trim(),
        email: normalizedEmail,
        phone: phone.trim(),
        company: company?.trim() || null,
        service: normalizedService,
        message: message.trim(),
        status: "new",
        emailStatus: "pending",
        country: country,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });
    }

    const redisKey = `email_lock:${normalizedEmail}:${normalizedService}`;
    const alreadyQueued = await redis.get(redisKey);

    if (!alreadyQueued) {
      await redis.setex(redisKey, EMAIL_DEDUPE_TTL, "1"); // More idiomatic Redis command

      await emailQueue.add(
        "send-contact-confirmation",
        {
          contactId: contact._id.toString(),
          email: normalizedEmail,
          fullName: contact.fullName,
          service: normalizedService,
        },
        {
          jobId: `contact-email-${contact._id}`,
          removeOnComplete: true,
          removeOnFail: false,
        },
      );

      console.log(`📬 Email job queued for: ${normalizedEmail}`);
    } else {
      console.log(`⏭️ Email already queued for: ${normalizedEmail} (dedupe TTL: ${EMAIL_DEDUPE_TTL}s)`);
    }

    return res.status(isNewContact ? 201 : 200).json({
      success: true,
      message: isNewContact
        ? "Form submitted successfully. We'll contact you soon!"
        : "Your request has been updated successfully.",
    });
  } catch (error) {
    if (error.name === "ZodError") {
      return res.status(400).json({
        success: false,
        message: error.errors[0]?.message || "Validation failed", // More user-friendly
      });
    }

    console.error("❌ Contact form error:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong. Please try again later.",
    });
  }
};