import { Router } from "express";

import { chatController } from "../controllers/chat.controller.js";
import { sanitizeChatInput } from "../middlewares/sanitizeInput.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import { chatRequestSchema } from "../validators/chat.validator.js";

const router = Router();

router.post(
  "/",
  sanitizeChatInput,
  validateRequest(chatRequestSchema),
  chatController
);

export default router;