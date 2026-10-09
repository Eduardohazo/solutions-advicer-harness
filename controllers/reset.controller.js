import { resetConversation } from "../services/chat.service.js";

export function resetController(req, res, next) {
  try {
    const { userId } = req.validatedBody;

    if (userId) {
      resetConversation(userId);
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}