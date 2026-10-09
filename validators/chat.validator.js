import { z } from "zod";

export const chatRequestSchema = z.object({
  userId: z.string().min(1).max(128),
  prompt: z.string().min(1).max(6000)
}).strict();

export const resetRequestSchema = z.object({
  userId: z.string().min(1).max(128)
}).strict();