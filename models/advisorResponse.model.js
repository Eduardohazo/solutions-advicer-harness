import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);

const diagnosisItemSchema = z.object({
  area_id: nonEmptyString,
  capa_id: nonEmptyString,
  prioridad: z.enum(["alta", "media", "baja"]),
  motivo: nonEmptyString,
  evidencia: nonEmptyString,
  soluciones: z.array(nonEmptyString)
}).strict();

const conclusionSchema = z.object({
  resumen: z.string(),
  siguiente_paso: z.string()
}).strict();

export const advisorResponseSchema = z.discriminatedUnion("estado", [
  z.object({
    estado: z.literal("inicio"),
    pregunta: nonEmptyString
  }).strict(),

  z.object({
    estado: z.literal("descubrimiento"),
    pregunta: nonEmptyString
  }).strict(),

  z.object({
    estado: z.literal("objecion"),
    respuesta_sugerida: nonEmptyString,
    siguiente_pregunta: nonEmptyString
  }).strict(),

  z.object({
    estado: z.literal("diagnostico"),
    diagnostico: z.array(diagnosisItemSchema),
    conclusion: conclusionSchema
  }).strict()
]);