import { processChat } from "../services/chat.service.js";

export async function chatController(req, res, next) {
  try {
    const { userId, prompt } = req.validatedBody;

    const response = await processChat({ userId, prompt });

    return res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}