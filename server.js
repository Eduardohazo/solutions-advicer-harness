import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import Groq from "groq-sdk";

import {
  loadJson,
  getCompactCatalog
} from "./context/knowledge.js";

import {
  personality
} from "./context/personality.js";

import {
  stateInstructions
} from "./context/stateInstructions.js";

dotenv.config();

const __filename =
  fileURLToPath(import.meta.url);

const __dirname =
  path.dirname(__filename);

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


// const allowedOrigins = ['http://127.0.0.1:5500']; // On Development ***
const allowedOrigins = ["https://solutions-advicer.netlify"]; // On Production ***

const corsOptions = {
  origin: function (origin, callback) {
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions)); // On Production or development ***

app.use(
  express.json({
    limit: "2mb"
  })
);

const frontendPath =
  path.join(
    __dirname,
    "../frontend"
  );

app.use(
  express.static(frontendPath)
);

/*
==================================================
MEMORIA
==================================================
*/

const conversations = new Map();

/*
==================================================
UTILIDADES
==================================================
*/

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function parseAgentJson(text) {
  if (!text) {
    return null;
  }

  let clean =
    String(text).trim();

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

function trimHistory(history) {
  if (
    history.length <=
    MAX_HISTORY
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

function conversationText(history) {
  return history
    .map(
      (message, index) => {
        const role =
          message.role === "user"
            ? "ENTRADA DEL VENDEDOR"
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

/*
==================================================
DETECCIÓN DEL COMANDO DE DIAGNÓSTICO
==================================================
*/

function isDiagnosisRequest(text) {
  const value =
    normalize(text);

  return (
    value.includes("diagnostico") ||
    value.includes("diagnóstico") ||
    value.includes("haz el analisis") ||
    value.includes("haz el análisis") ||
    value.includes("genera el analisis") ||
    value.includes("genera el análisis") ||
    value.includes("haz el diagnostico") ||
    value.includes("haz el diagnóstico") ||
    value === "analisis" ||
    value === "análisis" ||
    value === "diagnostico" ||
    value === "diagnóstico"
  );
}

/*
==================================================
GROQ
==================================================
*/

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
      maxTokens,

    response_format: {
      type: "json_object"
    }
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
      response
        ?.choices?.[0]
        ?.message
        ?.content || "";

    return {
      raw,
      parsed:
        parseAgentJson(raw)
    };
  } catch (error) {
    const status =
      error?.status;

    if (
      status === 429 &&
      FALLBACK_MODEL
    ) {
      console.warn(
        "Usando modelo fallback."
      );

      const response =
        await callGroq(
          FALLBACK_MODEL,
          messages,
          maxTokens
        );

      const raw =
        response
          ?.choices?.[0]
          ?.message
          ?.content || "";

      return {
        raw,
        parsed:
          parseAgentJson(raw)
      };
    }

    throw error;
  }
}

/*
==================================================
CHAT NORMAL
==================================================
*/

async function generateAdvisorResponse(
  history
) {
  const messages = [
    personality,
    stateInstructions,
    ...history
  ];

  const response =
    await askGroq(
      messages,
      1200
    );

  if (
    !response.parsed ||
    typeof response.parsed.estado !==
      "string"
  ) {
    throw new Error(
      "La IA devolvió una respuesta de consejero inválida."
    );
  }

  return response.parsed;
}

/*
==================================================
DIAGNÓSTICO
==================================================
*/

function enrichDiagnosis(
  diagnosis
) {
  if (
    !Array.isArray(diagnosis)
  ) {
    return [];
  }

  const catalog =
    loadJson(
      "catalog.json"
    );

  const solutions =
    loadJson(
      "solutions.json"
    );

  const areas =
    Array.isArray(
      catalog.areas
    )
      ? catalog.areas
      : [];

  const capas =
    Array.isArray(
      catalog.capas
    )
      ? catalog.capas
      : [];

  const areaMap =
    new Map(
      areas.map(
        area => [
          normalize(area.id),
          area
        ]
      )
    );

  const capaMap =
    new Map(
      capas.map(
        capa => [
          normalize(capa.id),
          capa
        ]
      )
    );

  const solutionMap =
    new Map(
      solutions.map(
        solution => [
          normalize(solution.id),
          solution
        ]
      )
    );

  const result = [];

  for (
    const item of diagnosis
  ) {
    if (
      !item ||
      typeof item !==
        "object"
    ) {
      continue;
    }

    const areaId =
      item.area_id ||
      item.area;

    const capaId =
      item.capa_id ||
      item.capa;

    const area =
      areaMap.get(
        normalize(areaId)
      );

    const capa =
      capaMap.get(
        normalize(capaId)
      );

    if (
      !area ||
      !capa
    ) {
      continue;
    }

    const cell =
      `${area.id}.${capa.id}`;

    const covering =
      solutions.filter(
        solution =>
          Array.isArray(
            solution.cubre
          ) &&
          solution.cubre.some(
            value =>
              normalize(value) ===
              normalize(cell)
          )
      );

    const requested =
      Array.isArray(
        item.soluciones
      )
        ? item.soluciones
        : [];

    const selected =
      requested
        .map(
          solutionId =>
            solutionMap.get(
              normalize(
                typeof solutionId ===
                  "string"
                  ? solutionId
                  : solutionId?.id
              )
            )
        )
        .filter(
          solution =>
            solution &&
            covering.some(
              valid =>
                normalize(
                  valid.id
                ) ===
                normalize(
                  solution.id
                )
            )
        );

    const finalSolutions =
      selected.length
        ? selected
        : covering.slice(0, 3);

    result.push({
      area:
        area.id,

      area_nombre:
        area.nombre,

      capa:
        capa.id,

      capa_nombre:
        capa.nombre,

      prioridad:
        normalize(
          item.prioridad
        ) || "media",

      motivo:
        item.motivo || "",

      evidencia:
        item.evidencia || "",

      soluciones:
        finalSolutions.map(
          solution => ({
            id:
              solution.id,

            nombre:
              solution.nombre,

            categoria:
              solution.categoria ||
              "",

            descripcion:
              solution.descripcion ||
              "",

            necesidad_que_atiende:
              solution.necesidad_que_atiende ||
              "",

            que_validar:
              solution.que_validar ||
              [],

            url:
              solution.url ||
              ""
          })
        )
    });
  }

  return result;
}

function diagnosisPrompt(
  history
) {
  return `
Eres un analista comercial de ciberseguridad.

Debes generar un diagnóstico para el vendedor.

El vendedor ha proporcionado información sobre una empresa
durante una conversación comercial.

Tu tarea NO es demostrar que la empresa tiene vulnerabilidades.

Tu tarea es identificar qué áreas de protección son relevantes
con base en la información disponible.

NO inventes:

- incidentes;
- ataques;
- vulnerabilidades;
- tecnologías;
- productos;
- problemas;
- IDs.

Puedes inferir RELEVANCIA de una protección cuando el contexto
empresarial la hace razonablemente aplicable.

IMPORTANTE:

Si existe información suficiente para identificar una necesidad
general de protección, NO devuelvas un diagnóstico vacío.

Debes seleccionar al menos una celda cuando sea posible.

Utiliza EXCLUSIVAMENTE las celdas del catálogo.

CATÁLOGO:

${getCompactCatalog()}

CONTEXTO COMERCIAL:

${conversationText(history)}

FORMATO OBLIGATORIO:

{
  "diagnostico": [
    {
      "area_id": "ID_EXISTENTE",
      "capa_id": "ID_EXISTENTE",
      "prioridad": "alta",
      "motivo": "Motivo comercial breve.",
      "evidencia": "Dato del contexto.",
      "soluciones": [
        "ID_SOLUCION_EXISTENTE"
      ]
    }
  ],
  "conclusion": {
    "resumen": "Resumen breve.",
    "prioridades": [
      "Prioridad"
    ],
    "siguiente_paso": "Siguiente paso comercial."
  }
}

Máximo 10 celdas.

Devuelve únicamente JSON.
`;
}

async function generateDiagnosis(
  history
) {
  console.log(
    "\n===== CONTEXTO COMERCIAL ENVIADO AL DIAGNÓSTICO ====="
  );

  console.log(
    conversationText(history)
  );

  console.log(
    "===== FIN DEL CONTEXTO COMERCIAL =====\n"
  );

  /*
  PRIMER INTENTO
  */

  const first =
    await askGroq(
      [
        {
          role: "system",
          content:
            diagnosisPrompt(
              history
            )
        }
      ],
      3500
    );

  const firstDiagnosis =
    enrichDiagnosis(
      first.parsed?.diagnostico
    );

  if (
    firstDiagnosis.length > 0
  ) {
    return {
      ...first.parsed,
      diagnostico:
        firstDiagnosis
    };
  }

  console.warn(
    "El modelo devolvió JSON válido pero diagnóstico vacío o inválido."
  );

  console.warn(
    first.raw
  );

  /*
  SEGUNDO INTENTO.
  */

  const second =
    await askGroq(
      [
        {
          role: "system",
          content:
            diagnosisPrompt(
              history
            )
        },

        {
          role: "user",
          content: `
La respuesta anterior no produjo ninguna celda válida.

Corrígela.

Debes seleccionar al menos una celda si existe información
empresarial suficiente.

No respondas que falta información si ya existen datos sobre
el giro, tamaño, usuarios, sistemas, información, infraestructura,
sucursales, operación o dependencia tecnológica de la empresa.

Selecciona solamente IDs existentes en el catálogo.
`
        }
      ],
      3500
    );

  const secondDiagnosis =
    enrichDiagnosis(
      second.parsed?.diagnostico
    );

  if (
    secondDiagnosis.length > 0
  ) {
    return {
      ...second.parsed,
      diagnostico:
        secondDiagnosis
    };
  }

  /*
  TERCER INTENTO:
  selección directa.
  */

  const third =
    await askGroq(
      [
        {
          role: "system",
          content: `
Selecciona áreas de protección de ciberseguridad.

No determines vulnerabilidades.

Determina qué protecciones son pertinentes para la empresa.

Utiliza solamente CELDAS DISPONIBLES.

Debes devolver al menos una celda si existe información empresarial.

CELDAS DISPONIBLES:

${getCompactCatalog()}

FORMATO:

{
  "diagnostico": [
    {
      "area_id": "ID",
      "capa_id": "ID",
      "prioridad": "alta",
      "motivo": "motivo",
      "evidencia": "evidencia",
      "soluciones": []
    }
  ],
  "conclusion": {
    "resumen": "",
    "prioridades": [],
    "siguiente_paso": ""
  }
}
`
        },

        {
          role: "user",
          content:
            conversationText(
              history
            )
        }
      ],
      3500
    );

  const thirdDiagnosis =
    enrichDiagnosis(
      third.parsed?.diagnostico
    );

  if (
    thirdDiagnosis.length > 0
  ) {
    return {
      ...third.parsed,
      diagnostico:
        thirdDiagnosis
    };
  }

  throw new Error(
    "La IA no pudo generar un diagnóstico con celdas válidas."
  );
}

/*
==================================================
ANÁLISIS DE SOLUCIONES
==================================================
*/

async function generateSolutionAnalysis(
  history,
  diagnosis
) {
  const solutions =
    loadJson(
      "solutions.json"
    );

  const ids = [
    ...new Set(
      diagnosis.flatMap(
        item =>
          item.soluciones.map(
            solution =>
              solution.id
          )
      )
    )
  ];

  if (
    ids.length === 0
  ) {
    return [];
  }

  const selected =
    solutions.filter(
      solution =>
        ids.includes(
          solution.id
        )
    );

  const prompt = `
Analiza las soluciones de ciberseguridad seleccionadas.

Explica brevemente POR QUÉ cada solución es pertinente
para la empresa según el contexto comercial.

NO inventes problemas.

NO inventes funcionalidades.

CONTEXTO:

${conversationText(history)}

DIAGNÓSTICO:

${JSON.stringify(
  diagnosis,
  null,
  2
)}

SOLUCIONES:

${JSON.stringify(
  selected,
  null,
  2
)}

Devuelve:

{
  "soluciones": [
    {
      "id": "ID",
      "por_que_aplica": "Explicación concreta."
    }
  ]
}

JSON válido únicamente.
`;

  const response =
    await askGroq(
      [
        {
          role: "system",
          content:
            prompt
        }
      ],
      3000
    );

  return Array.isArray(
    response.parsed?.soluciones
  )
    ? response.parsed.soluciones
    : [];
}

/*
==================================================
API CHAT
==================================================
*/

app.post(
  "/api/chat",
  async (
    req,
    res
  ) => {
    try {
      const prompt =
        String(
          req.body?.prompt ??
          req.body?.message ??
          ""
        ).trim();

      const userId =
        String(
          req.body?.userId ??
          req.body?.conversationId ??
          "default"
        );

      if (!prompt) {
        return res.status(400).json({
          error:
            "El mensaje está vacío."
        });
      }

      if (
        !conversations.has(
          userId
        )
      ) {
        conversations.set(
          userId,
          []
        );
      }

      const history =
        conversations.get(
          userId
        );

      /*
      DIAGNÓSTICO
      */

      if (
        isDiagnosisRequest(
          prompt
        )
      ) {
        const context =
          [...history];

        const diagnosis =
          await generateDiagnosis(
            context
          );

        const analysis =
          await generateSolutionAnalysis(
            context,
            diagnosis.diagnostico
          );

        const analysisMap =
          new Map(
            analysis.map(
              item => [
                item.id,
                item.por_que_aplica
              ]
            )
          );

        const finalDiagnosis =
          diagnosis.diagnostico.map(
            item => ({
              ...item,

              soluciones:
                item.soluciones.map(
                  solution => ({
                    ...solution,

                    por_que_aplica:
                      analysisMap.get(
                        solution.id
                      ) || ""
                  })
                )
            })
          );

        /*
        Guardamos el diagnóstico,
        pero NO guardamos el comando
        "haz el análisis" como mensaje
        del vendedor.
        */

        history.push({
          role: "assistant",

          content:
            JSON.stringify({
              estado:
                "diagnostico",
              diagnostico:
                finalDiagnosis
            })
        });

        trimHistory(
          history
        );

        return res.json({
          estado:
            "diagnostico",

          diagnostico:
            finalDiagnosis,

          conclusion:
            diagnosis.conclusion ||
            {
              resumen: "",
              prioridades: [],
              siguiente_paso: ""
            }
        });
      }

      /*
      CONVERSACIÓN NORMAL
      */

      history.push({
        role: "user",

        content:
          prompt.slice(
            0,
            MAX_MESSAGE_LENGTH
          )
      });

      trimHistory(
        history
      );

      const response =
        await generateAdvisorResponse(
          history
        );

      history.push({
        role: "assistant",

        content:
          JSON.stringify(
            response
          )
      });

      trimHistory(
        history
      );

      return res.json(
        response
      );

    } catch (error) {
      console.error(
        "Error interacting with GROQ API:"
      );

      console.error(
        error
      );

      return res.status(500).json({
        error:
          error?.message ||
          "Error procesando la solicitud."
      });
    }
  }
);

/*
==================================================
CATÁLOGO
==================================================
*/

app.get(
  "/api/catalog",
  (req, res) => {
    try {
      res.json(
        loadJson(
          "catalog.json"
        )
      );
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

/*
==================================================
RESET
==================================================
*/

app.post(
  "/api/reset",
  (req, res) => {
    const userId =
      String(
        req.body?.userId ??
        req.body?.conversationId ??
        "default"
      );

    conversations.delete(
      userId
    );

    res.json({
      ok: true
    });
  }
);

/*
==================================================
FRONTEND FALLBACK
==================================================
*/

app.get(
  "/{*splat}",
  (req, res) => {
    res.sendFile(
      path.join(
        frontendPath,
        "index.html"
      )
    );
  }
);

/*
==================================================
SERVER
==================================================
*/

app.listen(
  PORT,
  () => {
    console.log(
      `Servidor ejecutándose en http://localhost:${PORT}`
    );

    console.log(
      `Modelo: ${PRIMARY_MODEL}`
    );
  }
);