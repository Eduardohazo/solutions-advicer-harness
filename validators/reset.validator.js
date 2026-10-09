import { z } from "zod";

export const resetRequestSchema = z.object({
  userId: z.string().max(128).optional()
}).strict();

