import { z } from "zod";
import { advisorResponseSchema } from "../models/advisorResponse.model.js";

const publicSolutionSchema = z.object({
  id: z.string(),
  nombre: z.string(),
  categoria: z.string(),
  descripcion: z.string(),
  necesidad_que_atiende: z.string(),
  que_validar: z.array(z.unknown()),
  url: z.string(),
  por_que_aplica: z.string()
}).strict();

const enrichedDiagnosisSchema = z.object({
  area_id: z.string(),
  area_nombre: z.string(),
  capa_id: z.string(),
  capa_nombre: z.string(),
  prioridad: z.enum(["alta", "media", "baja"]),
  motivo: z.string(),
  evidencia: z.string(),
  soluciones: z.array(publicSolutionSchema)
}).strict();

const finalDiagnosisSchema = z.object({
  estado: z.literal("diagnostico"),
  diagnostico: z.array(enrichedDiagnosisSchema),
  conclusion: z.object({
    resumen: z.string(),
    siguiente_paso: z.string()
  }).strict()
}).strict();

export function validateApiResponse(data) {
  const result = data?.estado === "diagnostico"
    ? finalDiagnosisSchema.safeParse(data)
    : advisorResponseSchema.safeParse(data);

  if (!result.success) {
    const error = new Error(
      "La respuesta final de la API no cumple el esquema esperado."
    );

    error.status = 502;
    error.details = result.error.issues;

    throw error;
  }

  return result.data;
}