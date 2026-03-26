import { Router } from "express";
import { contactForm } from "../controllers/contact.controller.js";

const contactRoute = Router();

contactRoute.post("/", contactForm);

export default contactRoute;