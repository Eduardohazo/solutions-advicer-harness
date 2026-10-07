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

function trimHistory(history) {
  if (
    history.length <= MAX_HISTORY
  ) {
    return;
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
}

/* =========================================================
   JSON
========================================================= */

function parseAgentJson(text) {
  if (!text) {
    return null;
  }

  let clean =
    String(text)
      .trim();

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

  try {
    return JSON.parse(clean);
  } catch {
    const first =
      clean.indexOf("{");

    const last =
      clean.lastIndexOf("}");

    if (
      first === -1 ||
      last === -1 ||
      last <= first
    ) {
      return null;
    }

    try {
      return JSON.parse(
        clean.slice(
          first,
          last + 1
        )
      );
    } catch {
      return null;
    }
  }
}

/* =========================================================
   VALIDACIÓN
========================================================= */

function validateAdvisorResponse(data) {
  if (
    !data ||
    typeof data !== "object"
  ) {
    return false;
  }

  if (
    ![
      "inicio",
      "descubrimiento",
      "objecion"
    ].includes(data.estado)
  ) {
    return false;
  }

  return true;
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

  return true;
}

/* =========================================================
   DETECCIÓN DE DIAGNÓSTICO
========================================================= */

function isDiagnosisRequest(text) {
  const value =
    normalize(text);

  const exactCommands = [
    "diagnostico",
    "analisis",
    "matriz",
    "haz el analisis",
    "haz el diagnostico",
    "genera el analisis",
    "genera el diagnostico",
    "analisis completo",
    "diagnostico completo"
  ];

  if (
    exactCommands.includes(value)
  ) {
    return true;
  }

  const phrases = [
    "haz el analisis",
    "haz el diagnostico",
    "genera el analisis",
    "genera el diagnostico",
    "haz la matriz",
    "genera la matriz",
    "haz el analisis con esto",
    "haz el diagnostico con esto",
    "hazlo con esta informacion",
    "hazlo con la informacion",
    "hazlo con lo que tenemos",
    "hazlo con lo que te di",
    "hazlo con lo anterior",
    "ya con eso",
    "con eso es suficiente",
    "con eso puedes hacerlo",
    "ya puedes hacerlo",
    "puedes hacerlo con eso",
    "trata de hacerlo",
    "trata de hacerlo con lo que tenemos",
    "genera el diagnostico con esto",
    "genera el analisis con esto",
    "genera el diagnostico con la informacion",
    "genera el analisis con la informacion",
    "ya tenemos suficiente informacion"
  ];

  return phrases.some(
    phrase =>
      value.includes(phrase)
  );
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

async function askGroq(
  messages,
  maxTokens = 1500
) {
  try {
    const response =
      await callGroq(
        PRIMARY_MODEL,
        messages,
        maxTokens
      );

    const raw =
      response?.choices?.[0]
        ?.message
        ?.content || "";

    const parsed =
      parseAgentJson(raw);

    if (!parsed) {
      console.error(
        "Respuesta RAW de Groq:"
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

  } catch (error) {

    if (
      error?.status === 429 &&
      FALLBACK_MODEL &&
      FALLBACK_MODEL !== PRIMARY_MODEL
    ) {
      console.warn(
        "Usando modelo fallback por rate limit."
      );

      const response =
        await callGroq(
          FALLBACK_MODEL,
          messages,
          maxTokens
        );

      const raw =
        response?.choices?.[0]
          ?.message
          ?.content || "";

      const parsed =
        parseAgentJson(raw);

      if (!parsed) {
        console.error(
          "Respuesta RAW del fallback:"
        );

        console.error(raw);

        throw new Error(
          "El modelo fallback no devolvió JSON válido."
        );
      }

      return {
        raw,
        parsed
      };
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
  const catalog =
    getCompactCatalogAndSolutions();

  const prompt = `
${stateInstructions.content}

${catalog}

INFORMACIÓN DE LA CONVERSACIÓN:

${conversationText(history)}

DATOS CONFIRMADOS DEL VENDEDOR:

${evidenceText(history)}

GENERA LA SIGUIENTE RESPUESTA.

Si es la primera interacción:
{
  "estado": "inicio",
  "pregunta": "Dame un resumen de la empresa y de cómo opera."
}

Si corresponde continuar descubrimiento:
{
  "estado": "descubrimiento",
  "pregunta": "..."
}

Si existe una objeción:
{
  "estado": "objecion",
  "respuesta_sugerida": "...",
  "siguiente_pregunta": "..."
}

RECUERDA:

- solamente una pregunta;
- no productos;
- no inventes datos;
- JSON válido;
- sin Markdown;
- sin texto fuera del JSON.
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
      1200
    );

  if (
    !validateAdvisorResponse(
      result.parsed
    )
  ) {
    throw new Error(
      "La respuesta del asesor no tiene un formato válido."
    );
  }

  return result.parsed;
}

/* =========================================================
   DIAGNÓSTICO
========================================================= */

function diagnosisPrompt(
  history
) {
  const catalog =
    getCompactCatalogAndSolutions();

  return `
${stateInstructions.content}

${catalog}

DATOS CONFIRMADOS DEL VENDEDOR:

${evidenceText(history)}

CONTEXTO COMPLETO:

${conversationText(history)}

GENERA EL DIAGNÓSTICO.

Debes devolver exactamente esta estructura:

{
  "estado": "diagnostico",
  "diagnostico": [
    {
      "area_id": "ID_AREA",
      "capa_id": "ID_CAPA",
      "prioridad": "alta",
      "motivo": "Explicación breve",
      "evidencia": "Información que proporcionó el vendedor o indicación de que debe validarse",
      "soluciones": [
        "ID_SOLUCION"
      ]
    }
  ],
  "conclusion": {
    "resumen": "Resumen ejecutivo",
    "siguiente_paso": "Siguiente paso comercial"
  }
}

REGLAS:

1. Usa solamente IDs existentes en el catálogo.

2. "area_id" debe ser un ID existente.

3. "capa_id" debe ser un ID existente.

4. "prioridad" solamente puede ser:
   "alta", "media" o "baja".

5. "soluciones" solamente contiene IDs.

6. Nunca pongas nombres de productos en "soluciones".

7. Nunca pongas Markdown en "soluciones".

8. Nunca pongas barras verticales en "soluciones".

9. Nunca pongas comas dentro de un mismo ID.

10. Cada oportunidad debe corresponder a una combinación
    válida de área + capa.

11. Una solución solamente puede seleccionarse si el catálogo
    indica que cubre esa combinación.

12. No afirmes vulnerabilidades no confirmadas.

13. Si existe poca información, puedes generar oportunidades
    potenciales que deban validarse.

14. No generes "prioridades" dentro de "conclusion".

15. No generes ninguna sección global de prioridades.

16. No hagas preguntas.

17. No escribas nada fuera del JSON.

18. Devuelve JSON válido.
`;
}

async function generateDiagnosis(
  history
) {
  const result =
    await askGroq(
      [
        personality,
        {
          role: "user",
          content:
            diagnosisPrompt(history)
        }
      ],
      2200
    );

  if (
    !validateDiagnosisResponse(
      result.parsed
    )
  ) {
    throw new Error(
      "El diagnóstico no tiene un formato válido."
    );
  }

  return result.parsed;
}

/* =========================================================
   ENRIQUECIMIENTO
========================================================= */

function enrichDiagnosis(
  diagnosis
) {
  const catalog =
    loadJson("catalog.json");

  const solutions =
    loadJson("solutions.json");

  const areas =
    Array.isArray(catalog.areas)
      ? catalog.areas
      : [];

  const capas =
    Array.isArray(catalog.capas)
      ? catalog.capas
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

  for (
    const item
    of diagnosis.diagnostico
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

    if (!area || !capa) {
      continue;
    }

    const cellId =
      `${area.id}.${capa.id}`;

    const covering =
      solutions.filter(
        solution =>
          Array.isArray(
            solution.cubre
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
        item.motivo || "",

      evidencia:
        item.evidencia || "",

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
      "critica"
    ].includes(normalized)
  ) {
    return "alta";
  }

  if (
    [
      "media",
      "medium"
    ].includes(normalized)
  ) {
    return "media";
  }

  if (
    [
      "baja",
      "low"
    ].includes(normalized)
  ) {
    return "baja";
  }

  return "baja";
}

/* =========================================================
   ANÁLISIS DE SOLUCIONES
========================================================= */

async function generateSolutionAnalysis(
  diagnosis
) {
  for (
    const item
    of diagnosis
  ) {
    for (
      const solution
      of item.soluciones || []
    ) {
      const prompt = `
Analiza la aplicación comercial de esta solución.

EMPRESA / CONTEXTO:
${item.evidencia || "No existe evidencia directa suficiente."}

MOTIVO:
${item.motivo || ""}

SOLUCIÓN:
${solution.nombre}

DESCRIPCIÓN:
${solution.descripcion}

NECESIDAD:
${solution.necesidad_que_atiende}

Responde solamente:

{
  "por_que_aplica": "Explicación breve y consultiva"
}

No inventes información.
Si la evidencia es insuficiente, indica que debe validarse.
Devuelve únicamente JSON válido.
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
          result.parsed &&
          typeof result.parsed.por_que_aplica ===
            "string"
        ) {
          solution.por_que_aplica =
            result.parsed.por_que_aplica;
        }

      } catch (error) {
        console.error(
          "Error analizando solución:",
          error.message
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
      const userId =
        String(
          req.body?.userId || ""
        ).trim();

      const prompt =
        String(
          req.body?.prompt || ""
        ).trim();

      if (!userId) {
        return res.status(400).json({
          error:
            "Falta userId."
        });
      }

      if (!prompt) {
        return res.status(400).json({
          error:
            "Falta prompt."
        });
      }

      if (
        prompt.length >
        MAX_MESSAGE_LENGTH
      ) {
        return res.status(400).json({
          error:
            `El mensaje no puede superar ${MAX_MESSAGE_LENGTH} caracteres.`
        });
      }

      let history =
        conversations.get(userId);

      if (!history) {
        history = [];

        conversations.set(
          userId,
          history
        );
      }

      /* ===============================================
         DIAGNÓSTICO
      =============================================== */

      if (
        isDiagnosisRequest(prompt)
      ) {
        const diagnosisHistory =
          [...history];

        const diagnosis =
          await generateDiagnosis(
            diagnosisHistory
          );

        const enriched =
          enrichDiagnosis(
            diagnosis
          );

        const analyzed =
          await generateSolutionAnalysis(
            enriched
          );

        history.push({
          role: "assistant",
          content: JSON.stringify({
            estado:
              "diagnostico",

            diagnostico:
              analyzed,

            conclusion:
              diagnosis.conclusion
          })
        });

        trimHistory(history);

        return res.json({
          estado:
            "diagnostico",

          diagnostico:
            analyzed,

          conclusion:
            diagnosis.conclusion
        });
      }

      /* ===============================================
         MENSAJE NORMAL
      =============================================== */

      history.push({
        role: "user",
        content: prompt
      });

      trimHistory(history);

      const response =
        await generateAdvisorResponse(
          history
        );

      history.push({
        role: "assistant",
        content:
          JSON.stringify(response)
      });

      trimHistory(history);

      return res.json(
        response
      );

    } catch (error) {
      console.error(
        "Error en /api/chat:"
      );

      console.error(
        error
      );

      const status =
        Number.isInteger(
          error?.status
        )
          ? error.status
          : 500;

      return res.status(
        status >= 400 &&
        status < 600
          ? status
          : 500
      ).json({
        error:
          error?.message ||
          "Error interno del servidor."
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

      res.json({
        areas:
          Array.isArray(
            catalog.areas
          )
            ? catalog.areas
            : [],

        capas:
          Array.isArray(
            catalog.capas
          )
            ? catalog.capas
            : []
      });

    } catch (error) {
      console.error(
        error
      );

      res.status(500).json({
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

    res.json({
      ok: true
    });
  }
);

/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/",
  (req, res) => {
    res.json({
      ok: true,
      service:
        "Consejero Cero Uno API"
    });
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