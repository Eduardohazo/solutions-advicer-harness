import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Groq from "groq-sdk";

import {
  loadJson,
  getCompactCatalogAndSolutions
} from "./context/knowledge.js";

import {
  personality
} from "./context/personality.js";

import {
  stateInstructions
} from "./context/stateInstructions.js";

dotenv.config();

const app = express();

/* =========================================================
   CONFIGURACIÓN
========================================================= */

const PORT =
  process.env.PORT || 3000;

const PRIMARY_MODEL =
  process.env.GROQ_MODEL ||
  "openai/gpt-oss-120b";

const FALLBACK_MODEL =
  process.env.GROQ_FALLBACK_MODEL ||
  "openai/gpt-oss-20b";

const MAX_HISTORY = 30;
const MAX_MESSAGE_LENGTH = 6000;

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

/* =========================================================
   CORS
========================================================= */

const allowedOrigins = [
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "https://solutions-advicer.netlify.app"
];

const corsOptions = {
  origin(origin, callback) {
    if (
      !origin ||
      allowedOrigins.includes(origin)
    ) {
      callback(null, true);
      return;
    }

    callback(
      new Error("Not allowed by CORS")
    );
  },

  methods: ["GET", "POST"],

  allowedHeaders: [
    "Content-Type",
    "Authorization"
  ]
};

app.use(
  cors(corsOptions)
);

app.use(
  express.json({
    limit: "2mb"
  })
);

/* =========================================================
   MEMORIA DE CONVERSACIONES
========================================================= */

const conversations = new Map();

/* =========================================================
   UTILIDADES
========================================================= */

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getEvidenceHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history.filter(
    message =>
      message &&
      message.role === "user" &&
      typeof message.content === "string" &&
      message.content.trim()
  );
}

function conversationText(history) {
  if (!Array.isArray(history)) {
    return "";
  }

  return history
    .map(
      (message, index) => {
        const role =
          message.role === "user"
            ? "VENDEDOR"
            : "CONSEJERO";

        return `
--- MENSAJE ${index + 1} ---
${role}:

${message.content}
`;
      }
    )
    .join("\n");
}

function evidenceText(history) {
  const evidence =
    getEvidenceHistory(history);

  if (evidence.length === 0) {
    return "No existe información proporcionada todavía.";
  }

  return evidence
    .map(
      (message, index) => `
--- DATO CONFIRMADO ${index + 1} ---
${message.content}
`
    )
    .join("\n");
}

/*
 * IMPORTANTE:
 * Esta función modifica el arreglo original y
 * TAMBIÉN LO DEVUELVE.
 *
 * Antes aquí faltaba "return history", lo que
 * convertía history en undefined.
 */
function trimHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  if (
    history.length <= MAX_HISTORY
  ) {
    return history;
  }

  const first =
    history[0];

  const recent =
    history.slice(
      -(MAX_HISTORY - 1)
    );

  history.length = 0;

  history.push(
    first,
    ...recent
  );

  return history;
}

/* =========================================================
   PARSER JSON ROBUSTO
========================================================= */

function parseAgentJson(text) {
  if (
    text === null ||
    text === undefined
  ) {
    return null;
  }

  let clean =
    String(text).trim();

  if (!clean) {
    return null;
  }

  /*
   * Elimina bloques Markdown.
   */
  clean = clean
    .replace(
      /^```json\s*/i,
      ""
    )
    .replace(
      /^```\s*/i,
      ""
    )
    .replace(
      /\s*```$/i,
      ""
    )
    .trim();

  /*
   * Intento directo.
   */
  try {
    return JSON.parse(clean);
  } catch {
    // Continúa con extracción.
  }

  /*
   * Busca el primer objeto JSON.
   */
  const firstObject =
    clean.indexOf("{");

  const lastObject =
    clean.lastIndexOf("}");

  if (
    firstObject !== -1 &&
    lastObject !== -1 &&
    lastObject > firstObject
  ) {
    const candidate =
      clean.slice(
        firstObject,
        lastObject + 1
      );

    try {
      return JSON.parse(candidate);
    } catch {
      // Continúa.
    }
  }

  /*
   * También soportamos accidentalmente un array JSON.
   */
  const firstArray =
    clean.indexOf("[");

  const lastArray =
    clean.lastIndexOf("]");

  if (
    firstArray !== -1 &&
    lastArray !== -1 &&
    lastArray > firstArray
  ) {
    const candidate =
      clean.slice(
        firstArray,
        lastArray + 1
      );

    try {
      return JSON.parse(candidate);
    } catch {
      // No fue posible interpretar la respuesta.
    }
  }

  return null;
}

/* =========================================================
   VALIDACIÓN
========================================================= */

function validateAdvisorResponse(data) {
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data)
  ) {
    return false;
  }

  const validStates = [
    "inicio",
    "descubrimiento",
    "objecion",
    "diagnostico"
  ];

  if (
    !validStates.includes(
      data.estado
    )
  ) {
    return false;
  }

  if (
    data.estado === "inicio" ||
    data.estado === "descubrimiento"
  ) {
    return (
      typeof data.pregunta === "string" &&
      data.pregunta.trim().length > 0
    );
  }

  if (
    data.estado === "objecion"
  ) {
    return (
      typeof data.respuesta_sugerida === "string" &&
      data.respuesta_sugerida.trim().length > 0 &&
      typeof data.siguiente_pregunta === "string" &&
      data.siguiente_pregunta.trim().length > 0
    );
  }

  if (
    data.estado === "diagnostico"
  ) {
    return validateDiagnosisResponse(
      data
    );
  }

  return false;
}

function validateDiagnosisResponse(data) {
  if (
    !data ||
    typeof data !== "object"
  ) {
    return false;
  }

  if (
    data.estado !== "diagnostico"
  ) {
    return false;
  }

  if (
    !Array.isArray(
      data.diagnostico
    )
  ) {
    return false;
  }

  if (
    !data.conclusion ||
    typeof data.conclusion !== "object"
  ) {
    return false;
  }

  if (
    typeof data.conclusion.resumen !== "string"
  ) {
    return false;
  }

  if (
    typeof data.conclusion.siguiente_paso !== "string"
  ) {
    return false;
  }

  return true;
}

/* =========================================================
   GROQ
========================================================= */

async function callGroq(
  model,
  messages,
  maxTokens
) {
  const params = {
    model,
    messages,
    temperature: 0.2,
    max_completion_tokens:
      maxTokens
  };

  /*
   * GPT-OSS utiliza reasoning_effort.
   */
  if (
    model.startsWith(
      "openai/gpt-oss"
    )
  ) {
    params.reasoning_effort =
      "low";
  }

  return groq.chat.completions.create(
    params
  );
}

function extractGroqContent(response) {
  const message =
    response?.choices?.[0]?.message;

  if (!message) {
    return "";
  }

  /*
   * Normalmente usamos content.
   */
  if (
    typeof message.content === "string"
  ) {
    return message.content;
  }

  /*
   * Algunas respuestas pueden entregar
   * contenido en estructuras diferentes.
   */
  if (
    Array.isArray(message.content)
  ) {
    return message.content
      .map(item => {
        if (
          typeof item === "string"
        ) {
          return item;
        }

        if (
          item &&
          typeof item.text === "string"
        ) {
          return item.text;
        }

        return "";
      })
      .join("");
  }

  return "";
}

async function requestModel(
  model,
  messages,
  maxTokens
) {
  const response =
    await callGroq(
      model,
      messages,
      maxTokens
    );

  const raw =
    extractGroqContent(
      response
    );

  if (!raw) {
    console.error(
      `El modelo ${model} no devolvió contenido.`
    );

    console.error(
      JSON.stringify(
        response,
        null,
        2
      )
    );

    throw new Error(
      "El modelo no devolvió contenido."
    );
  }

  const parsed =
    parseAgentJson(raw);

  if (!parsed) {
    console.error(
      `Respuesta RAW de ${model}:`
    );

    console.error(raw);

    throw new Error(
      "La IA no devolvió JSON válido."
    );
  }

  return {
    raw,
    parsed
  };
}

async function askGroq(
  messages,
  maxTokens = 1500
) {
  try {
    return await requestModel(
      PRIMARY_MODEL,
      messages,
      maxTokens
    );

  } catch (error) {

    /*
     * Fallback para rate limit.
     */
    if (
      error?.status === 429 &&
      FALLBACK_MODEL &&
      FALLBACK_MODEL !== PRIMARY_MODEL
    ) {
      console.warn(
        "Modelo principal en rate limit. Usando fallback:",
        FALLBACK_MODEL
      );

      return await requestModel(
        FALLBACK_MODEL,
        messages,
        maxTokens
      );
    }

    throw error;
  }
}

/* =========================================================
   ADVISOR
========================================================= */

async function generateAdvisorResponse(
  history
) {
  /*
   * Protección adicional.
   * Nunca permitimos que esta función reciba
   * undefined.
   */
  if (!Array.isArray(history)) {
    history = [];
  }

  const catalog =
    getCompactCatalogAndSolutions();

  const isFirstInteraction =
    history.length === 1;

  const prompt = `
${stateInstructions.content}

${catalog}

INFORMACIÓN DE LA CONVERSACIÓN:
${conversationText(history)}

DATOS CONFIRMADOS DEL VENDEDOR:
${evidenceText(history)}

--------------------------------------------------
DECISIÓN DEL ESTADO
--------------------------------------------------

Debes decidir el estado correcto utilizando
el contexto completo de la conversación.

Los estados posibles son:

- inicio
- descubrimiento
- objecion
- diagnostico

NO dependas de una palabra específica para decidir
el estado.

Analiza la intención y el contexto completo.

--------------------------------------------------
SI DEBES CONTINUAR DESCUBRIMIENTO
--------------------------------------------------

Devuelve:

{
  "estado": "descubrimiento",
  "pregunta": "UNA sola pregunta concreta"
}

La pregunta debe depender de la información
que ya proporcionó el vendedor.

No repitas preguntas ya realizadas.

La pregunta debe ayudar a descubrir información
relevante para posteriormente recomendar soluciones.

--------------------------------------------------
SI EXISTE UNA OBJECIÓN
--------------------------------------------------

Devuelve:

{
  "estado": "objecion",
  "respuesta_sugerida": "Respuesta breve y consultiva",
  "siguiente_pregunta": "UNA sola pregunta concreta"
}

La respuesta debe:

- reconocer la posición del prospecto;
- evitar confrontarlo;
- no intentar vender inmediatamente;
- buscar abrir una oportunidad de conversación;
- no asumir que el proveedor actual es malo;
- no inventar problemas.

--------------------------------------------------
SI DEBES GENERAR DIAGNÓSTICO
--------------------------------------------------

NO hagas otra pregunta.

Devuelve:

{
  "estado": "diagnostico",
  "diagnostico": [
    {
      "area_id": "ID_AREA",
      "capa_id": "ID_CAPA",
      "prioridad": "alta",
      "motivo": "Explicación breve",
      "evidencia": "Información proporcionada por el vendedor o indicación de que debe validarse",
      "soluciones": ["ID_SOLUCION"]
    }
  ],
  "conclusion": {
    "resumen": "Resumen ejecutivo",
    "siguiente_paso": "Siguiente paso comercial"
  }
}

REGLAS DEL DIAGNÓSTICO:

- Utiliza únicamente IDs existentes en el catálogo.
- Utiliza únicamente combinaciones válidas de area_id + capa_id.
- Utiliza únicamente soluciones compatibles con esa combinación.
- No inventes vulnerabilidades.
- No inventes incidentes.
- No inventes incumplimientos.
- Si falta evidencia, indica que debe validarse.
- Puede existir una oportunidad potencial aunque no exista evidencia
  de una deficiencia.
- Cada oportunidad debe tener su propia prioridad.
- No generes prioridades globales.
- No hagas preguntas.
- No escribas nombres de productos dentro de "soluciones".
- "soluciones" debe contener únicamente IDs.
- Si existen varias oportunidades relevantes, puedes incluir varias.
- Si la evidencia es limitada, genera oportunidades potenciales
  pero deja claro que deben validarse.
- Siempre intenta identificar al menos una oportunidad razonable
  cuando el contexto permita hacerlo.
- No fuerces una solución que no tenga relación con la evidencia.

--------------------------------------------------
REGLAS GENERALES
--------------------------------------------------

- Devuelve únicamente JSON.
- No Markdown.
- No texto antes del JSON.
- No texto después del JSON.
- No razonamiento.
- No inventes información.
`;

  const result =
    await askGroq(
      [
        personality,
        {
          role: "user",
          content: prompt
        }
      ],
      2200
    );

  console.log(
    "RESPUESTA PARSEADA DEL CONSEJERO:"
  );

  console.log(
    JSON.stringify(
      result.parsed,
      null,
      2
    )
  );

  if (
    !validateAdvisorResponse(
      result.parsed
    )
  ) {
    console.error(
      "RESPUESTA INVÁLIDA DEL CONSEJERO:"
    );

    console.error(
      JSON.stringify(
        result.parsed,
        null,
        2
      )
    );

    throw new Error(
      "La respuesta del asesor no tiene un formato válido."
    );
  }

  return result.parsed;
}

/* =========================================================
   ENRIQUECIMIENTO DEL DIAGNÓSTICO
========================================================= */

function enrichDiagnosis(
  diagnosis
) {
  const catalog =
    loadJson(
      "catalog.json"
    );

  const solutionsData =
    loadJson(
      "solutions.json"
    );

  const areas =
    Array.isArray(
      catalog?.areas
    )
      ? catalog.areas
      : [];

  const capas =
    Array.isArray(
      catalog?.capas
    )
      ? catalog.capas
      : [];

  const solutions =
    Array.isArray(
      solutionsData
    )
      ? solutionsData
      : [];

  const solutionMap =
    new Map(
      solutions.map(
        solution => [
          solution.id,
          solution
        ]
      )
    );

  const areaMap =
    new Map(
      areas.map(
        area => [
          area.id,
          area
        ]
      )
    );

  const capaMap =
    new Map(
      capas.map(
        capa => [
          capa.id,
          capa
        ]
      )
    );

  const result = [];

  const diagnosisItems =
    Array.isArray(
      diagnosis?.diagnostico
    )
      ? diagnosis.diagnostico
      : [];

  for (
    const item
    of diagnosisItems
  ) {
    if (
      !item ||
      typeof item !== "object"
    ) {
      continue;
    }

    const area =
      areaMap.get(
        item.area_id
      );

    const capa =
      capaMap.get(
        item.capa_id
      );

    if (
      !area ||
      !capa
    ) {
      continue;
    }

    const cellId =
      `${area.id}.${capa.id}`;

    const covering =
      solutions.filter(
        solution =>
          Array.isArray(
            solution?.cubre
          ) &&
          solution.cubre.includes(
            cellId
          )
      );

    const requestedIds =
      Array.isArray(
        item.soluciones
      )
        ? item.soluciones
        : [];

    const validRequested =
      requestedIds.filter(
        id =>
          typeof id === "string" &&
          covering.some(
            solution =>
              solution.id === id
          )
      );

    const selectedIds =
      validRequested.length > 0
        ? validRequested
        : covering
            .slice(0, 3)
            .map(
              solution =>
                solution.id
            );

    const enrichedSolutions =
      selectedIds
        .map(
          id =>
            solutionMap.get(id)
        )
        .filter(Boolean)
        .map(
          solution => ({
            id:
              solution.id,

            nombre:
              solution.nombre || "",

            categoria:
              solution.categoria || "",

            descripcion:
              solution.descripcion || "",

            necesidad_que_atiende:
              solution.necesidad_que_atiende ||
              "",

            que_validar:
              Array.isArray(
                solution.que_validar
              )
                ? solution.que_validar
                : [],

            url:
              solution.url || ""
          })
        );

    result.push({
      area_id:
        area.id,

      area_nombre:
        area.nombre,

      capa_id:
        capa.id,

      capa_nombre:
        capa.nombre,

      prioridad:
        normalizePriorityForServer(
          item.prioridad
        ),

      motivo:
        typeof item.motivo === "string"
          ? item.motivo
          : "",

      evidencia:
        typeof item.evidencia === "string"
          ? item.evidencia
          : "",

      soluciones:
        enrichedSolutions
    });
  }

  return result;
}

function normalizePriorityForServer(
  value
) {
  const normalized =
    normalize(value);

  if (
    [
      "alta",
      "high",
      "critica",
      "critical"
    ].includes(
      normalized
    )
  ) {
    return "alta";
  }

  if (
    [
      "media",
      "medium"
    ].includes(
      normalized
    )
  ) {
    return "media";
  }

  if (
    [
      "baja",
      "low"
    ].includes(
      normalized
    )
  ) {
    return "baja";
  }

  return "baja";
}

/* =========================================================
   ANÁLISIS COMERCIAL DE SOLUCIONES
========================================================= */

async function generateSolutionAnalysis(
  diagnosis
) {
  if (!Array.isArray(diagnosis)) {
    return [];
  }

  for (
    const item
    of diagnosis
  ) {
    if (
      !Array.isArray(
        item?.soluciones
      )
    ) {
      continue;
    }

    for (
      const solution
      of item.soluciones
    ) {
      const prompt = `
Analiza la aplicación comercial de esta solución.

CONTEXTO / EVIDENCIA:
${item.evidencia || "No existe evidencia directa suficiente."}

MOTIVO:
${item.motivo || ""}

ÁREA:
${item.area_nombre || ""}

CAPA:
${item.capa_nombre || ""}

SOLUCIÓN:
${solution.nombre || ""}

DESCRIPCIÓN:
${solution.descripcion || ""}

NECESIDAD:
${solution.necesidad_que_atiende || ""}

Responde solamente:

{
  "por_que_aplica": "Explicación breve y consultiva"
}

REGLAS:

- No inventes información.
- No afirmes que existe una vulnerabilidad si no hay evidencia.
- Si la evidencia es insuficiente, indica que debe validarse.
- Explica por qué la solución podría ser relevante comercialmente.
- Sé breve.
- Devuelve únicamente JSON válido.
`;

      try {
        const result =
          await askGroq(
            [
              personality,
              {
                role: "user",
                content: prompt
              }
            ],
            500
          );

        if (
          result?.parsed &&
          typeof result.parsed.por_que_aplica ===
          "string"
        ) {
          solution.por_que_aplica =
            result.parsed.por_que_aplica;
        } else {
          solution.por_que_aplica =
            "Conviene validar esta solución con el prospecto para confirmar su aplicabilidad.";
        }

      } catch (error) {
        console.error(
          "Error analizando solución:",
          error?.message || error
        );

        solution.por_que_aplica =
          "Conviene validar esta solución con el prospecto para confirmar su aplicabilidad.";
      }
    }
  }

  return diagnosis;
}

/* =========================================================
   CHAT
========================================================= */

app.post(
  "/api/chat",
  async (req, res) => {
    try {
      const {
        userId,
        prompt
      } = req.body || {};

      /* -----------------------------------------------------
         VALIDACIÓN
      ----------------------------------------------------- */

      if (
        !userId ||
        typeof userId !== "string"
      ) {
        return res.status(400).json({
          error:
            "userId es requerido."
        });
      }

      if (
        !prompt ||
        typeof prompt !== "string"
      ) {
        return res.status(400).json({
          error:
            "prompt es requerido."
        });
      }

      const cleanPrompt =
        prompt.trim();

      if (!cleanPrompt) {
        return res.status(400).json({
          error:
            "El mensaje no puede estar vacío."
        });
      }

      if (
        cleanPrompt.length >
        MAX_MESSAGE_LENGTH
      ) {
        return res.status(400).json({
          error:
            `El mensaje no puede superar ${MAX_MESSAGE_LENGTH} caracteres.`
        });
      }

      /* -----------------------------------------------------
         OBTENER CONVERSACIÓN
      ----------------------------------------------------- */

      let history =
        conversations.get(
          userId
        );

      if (
        !Array.isArray(history)
      ) {
        history = [];
      }

      /* -----------------------------------------------------
         AGREGAR MENSAJE DEL VENDEDOR
      ----------------------------------------------------- */

      history.push({
        role: "user",
        content: cleanPrompt
      });

      /*
       * IMPORTANTE:
       * trimHistory devuelve el arreglo.
       */
      history =
        trimHistory(history);

      /* -----------------------------------------------------
         GENERAR RESPUESTA
      ----------------------------------------------------- */

      const response =
        await generateAdvisorResponse(
          history
        );

      /* -----------------------------------------------------
         DIAGNÓSTICO
      ----------------------------------------------------- */

      if (
        response.estado ===
        "diagnostico"
      ) {
        const enrichedDiagnosis =
          enrichDiagnosis(
            response
          );

        const analyzedDiagnosis =
          await generateSolutionAnalysis(
            enrichedDiagnosis
          );

        const finalResponse = {
          estado:
            "diagnostico",

          diagnostico:
            analyzedDiagnosis,

          conclusion:
            response.conclusion
        };

        history.push({
          role: "assistant",
          content:
            JSON.stringify(
              finalResponse
            )
        });

        history =
          trimHistory(
            history
          );

        conversations.set(
          userId,
          history
        );

        return res.json(
          finalResponse
        );
      }

      /* -----------------------------------------------------
         RESPUESTA NORMAL
      ----------------------------------------------------- */

      history.push({
        role: "assistant",
        content:
          JSON.stringify(
            response
          )
      });

      history =
        trimHistory(
          history
        );

      conversations.set(
        userId,
        history
      );

      return res.json(
        response
      );

    } catch (error) {
      console.error(
        "Error en /api/chat:"
      );

      console.error(
        error?.stack ||
        error
      );

      return res.status(500).json({
        error:
          "No fue posible procesar la conversación."
      });
    }
  }
);

/* =========================================================
   CATÁLOGO
========================================================= */

app.get(
  "/api/catalog",
  (req, res) => {
    try {
      const catalog =
        loadJson(
          "catalog.json"
        );

      return res.json({
        areas:
          Array.isArray(
            catalog?.areas
          )
            ? catalog.areas
            : [],

        capas:
          Array.isArray(
            catalog?.capas
          )
            ? catalog.capas
            : []
      });

    } catch (error) {
      console.error(
        "Error cargando catálogo:",
        error
      );

      return res.status(500).json({
        error:
          "No se pudo cargar el catálogo."
      });
    }
  }
);

/* =========================================================
   RESET
========================================================= */

app.post(
  "/api/reset",
  (req, res) => {
    const userId =
      String(
        req.body?.userId || ""
      ).trim();

    if (userId) {
      conversations.delete(
        userId
      );
    }

    return res.json({
      ok: true
    });
  }
);

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get(
  "/",
  (req, res) => {
    return res.json({
      ok: true,
      service:
        "Consejero Cero Uno API",
      model:
        PRIMARY_MODEL
    });
  }
);

/* =========================================================
   MANEJO BÁSICO DE ERRORES DE CORS
========================================================= */

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    if (
      error?.message ===
      "Not allowed by CORS"
    ) {
      return res.status(403).json({
        error:
          "Origen no permitido por CORS."
      });
    }

    return next(error);
  }
);

/* =========================================================
   START
========================================================= */

app.listen(
  PORT,
  () => {
    console.log(
      `Servidor ejecutándose en http://localhost:${PORT}`
    );

    console.log(
      `Modelo principal: ${PRIMARY_MODEL}`
    );

    console.log(
      `Modelo fallback: ${FALLBACK_MODEL}`
    );
  }
);