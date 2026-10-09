import { personality } from "../context/personality.js";
import { stateInstructions } from "../context/stateInstructions.js";
import { getCompactCatalogAndSolutions } from "../context/knowledge.js";

import { askGroq } from "./grok.service.js";
import { validateAdvisorResponse } from "../validators/advisorResponse.validator.js";

import { env } from "../config/env.js";

function getEvidenceHistory(history) {
  return history.filter(
    message =>
      message.role === "user" &&
      typeof message.content === "string" &&
      message.content.trim()
  );
}

function conversationText(history) {
  return history.map((message, index) => {
    const role = message.role === "user" ? "VENDEDOR" : "CONSEJERO";

    return `--- MENSAJE ${index + 1} ---
${role}:

${message.content}`;
  }).join("\n");
}

function evidenceText(history) {
  const evidence = getEvidenceHistory(history);

  if (!evidence.length) {
    return "No existe información proporcionada todavía.";
  }

  return evidence.map((message, index) =>
    `--- DATO CONFIRMADO ${index + 1} ---
${message.content}`
  ).join("\n");
}

function trimHistory(history) {
  if (history.length <= env.maxHistory) {
    return history;
  }

  // Conserva el primer mensaje y los mensajes recientes.
  return [
    history[0],
    ...history.slice(-(env.maxHistory - 1))
  ];
}

export async function generateAdvisorResponse(history) {
  const safeHistory = Array.isArray(history) ? history : [];

  const catalog = getCompactCatalogAndSolutions();

  const prompt = `
${stateInstructions.content}

${catalog}

INFORMACIÓN DE LA CONVERSACIÓN:
${conversationText(safeHistory)}

DATOS CONFIRMADOS DEL VENDEDOR:
${evidenceText(safeHistory)}

--------------------------------------------------
DECISIÓN DEL ESTADO
--------------------------------------------------

Debes decidir el estado correcto utilizando el contexto
completo de la conversación. No dependas de una palabra
específica: analiza la intención y el contexto.

Estados posibles:
- inicio
- descubrimiento
- objecion
- diagnostico

--------------------------------------------------
DESCUBRIMIENTO
--------------------------------------------------

Devuelve:
{
  "estado": "descubrimiento",
  "pregunta": "UNA sola pregunta concreta"
}

La pregunta debe aprovechar el contexto disponible,
no repetir preguntas anteriores y ayudar a identificar
información relevante para una recomendación futura.

--------------------------------------------------
OBJECIÓN
--------------------------------------------------

Devuelve:
{
  "estado": "objecion",
  "respuesta_sugerida": "Respuesta breve y consultiva",
  "siguiente_pregunta": "UNA sola pregunta concreta"
}

Reconoce la posición del prospecto, no lo confrontes,
no vendas inmediatamente, no asumas que el proveedor
actual es malo y no inventes problemas.

--------------------------------------------------
DIAGNÓSTICO
--------------------------------------------------

No hagas otra pregunta. Devuelve:
{
  "estado": "diagnostico",
  "diagnostico": [
    {
      "area_id": "ID_AREA",
      "capa_id": "ID_CAPA",
      "prioridad": "alta",
      "motivo": "Explicación breve",
      "evidencia": "Dato confirmado o aspecto que debe validarse",
      "soluciones": ["ID_SOLUCION"]
    }
  ],
  "conclusion": {
    "resumen": "Resumen ejecutivo",
    "siguiente_paso": "Siguiente paso comercial"
  }
}

Reglas:
- Utiliza exclusivamente IDs existentes en el catálogo.
- Respeta las combinaciones válidas de área y capa.
- Selecciona únicamente soluciones compatibles con la combinación.
- No inventes vulnerabilidades, incidentes ni incumplimientos.
- Si falta evidencia, indica que debe validarse.
- Puedes identificar oportunidades potenciales sin presentarlas
  como deficiencias confirmadas.
- Cada oportunidad tiene su propia prioridad: alta, media o baja.
- No generes prioridades globales.
- No incluyas nombres de productos en "soluciones"; solo IDs.
- No fuerces una solución que no tenga relación con la evidencia.
- Si el contexto lo permite, intenta identificar una oportunidad
  razonable aunque la información sea limitada.
- No hagas preguntas cuando generes el diagnóstico.

--------------------------------------------------
SALIDA
--------------------------------------------------

Devuelve únicamente JSON válido.
No utilices Markdown ni texto fuera del JSON.
No inventes información ni muestres razonamiento interno.
`;

  const result = await askGroq([
    personality,
    {
      role: "user",
      content: prompt
    }
  ], 2200);

  const response = validateAdvisorResponse(result.parsed);

  return {
    response,
    history: trimHistory(safeHistory)
  };
}