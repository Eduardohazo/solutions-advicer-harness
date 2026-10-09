import { advisorResponseSchema } from "../models/advisorResponse.model.js";

export function validateAdvisorResponse(data) {
  const result = advisorResponseSchema.safeParse(data);

  if (!result.success) {
    const error = new Error(
      "La respuesta del consejero no tiene un formato válido."
    );

    error.status = 502;
    error.details = result.error.issues;

    throw error;
  }

  return result.data;
}