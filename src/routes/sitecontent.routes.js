import { Router } from "express";
import {
  getSiteContentAdmin,
  updateSiteContentAdmin,
} from "../controllers/sitecontent.controller.js";

const router = Router();

router.get("/", getSiteContentAdmin);
router.put("/", updateSiteContentAdmin);

export default router;

