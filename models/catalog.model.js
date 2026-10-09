import { z } from "zod";

const namedItemSchema = z.object({
  id: z.string().min(1),
  nombre: z.string().min(1)
}).passthrough();

export const catalogSchema = z.object({
  areas: z.array(namedItemSchema),
  capas: z.array(namedItemSchema)
}).passthrough();

export const solutionSchema = z.object({
  id: z.string().min(1),
  nombre: z.string().min(1),
  categoria: z.string(),
  descripcion: z.string(),
  cubre: z.array(z.string())
}).passthrough();

export const solutionsSchema = z.array(solutionSchema);