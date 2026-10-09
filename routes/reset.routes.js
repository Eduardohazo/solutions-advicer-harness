import { Router } from "express";

import { resetController } from "../controllers/reset.controller.js";
import { sanitizeUserId } from "../middlewares/sanitizeInput.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import { resetRequestSchema } from "../validators/reset.validator.js";

const router = Router();

router.post(
  "/",
  sanitizeUserId,
  validateRequest(resetRequestSchema),
  resetController
);

export default router;