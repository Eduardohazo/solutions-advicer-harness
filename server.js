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


/*
==================================================
CORS
==================================================
*/

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

  methods: [
    "GET",
    "POST"
  ],

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


/*
==================================================
FRONTEND
==================================================
*/

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

const conversations =
  new Map();


/*
==================================================
UTILIDADES
==================================================
*/

function normalize(value) {

  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    );
}


/*
--------------------------------------------------
Historial completo para el consejero
--------------------------------------------------
*/

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


/*
--------------------------------------------------
ÚNICAMENTE mensajes del vendedor.
Estos son los únicos que pueden utilizarse
como evidencia para el diagnóstico.
--------------------------------------------------
*/

function getEvidenceHistory(history) {

  if (
    !Array.isArray(history)
  ) {
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


function evidenceText(history) {

  const evidence =
    getEvidenceHistory(history);

  if (
    evidence.length === 0
  ) {
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
--------------------------------------------------
Busca una evidencia real dentro de las respuestas
del vendedor.
--------------------------------------------------
*/

function findEvidence(
  history,
  keywords
) {

  const evidence =
    getEvidenceHistory(history);

  for (
    const message of evidence
  ) {

    const text =
      normalize(
        message.content
      );

    const found =
      keywords.some(
        keyword =>
          text.includes(
            normalize(keyword)
          )
      );

    if (found) {
      return message.content;
    }
  }

  return evidence[0]?.content || "";
}


/*
--------------------------------------------------
JSON
--------------------------------------------------
*/

function parseAgentJson(text) {

  if (!text) {
    return null;
  }

  let clean =
    String(text).trim();

  clean =
    clean
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

    return JSON.parse(
      clean
    );

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


/*
--------------------------------------------------
Historial
--------------------------------------------------
*/

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


/*
==================================================
DETECCIÓN DE DIAGNÓSTICO
==================================================
*/

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

    if (
      error?.status === 429 &&
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
CONSEJERO
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
      1400
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
DIAGNÓSTICO - PROMPT
==================================================
*/

function diagnosisPrompt(history) {

  return `
Eres un analista comercial de ciberseguridad.

Tu tarea es identificar oportunidades de protección
para una empresa a partir de información comercial real.

==================================================
EVIDENCIA PERMITIDA
==================================================

Únicamente puedes utilizar:

${evidenceText(history)}

Los mensajes del CONSEJERO no son evidencia.

Las preguntas no son evidencia.

No conviertas una pregunta sin respuesta en un hecho.

==================================================
OBJETIVO
==================================================

No necesitas demostrar que existe una vulnerabilidad.

Debes identificar áreas y capas que sea razonable VALIDAR
considerando la información confirmada de la empresa.

Ejemplo:

Si sabemos que existen más de 1,000 empleados:

CORRECTO:
"El tamaño de la organización hace relevante validar
cómo se administran y protegen los equipos."

INCORRECTO:
"La empresa tiene equipos desprotegidos."

Si sabemos que existen plantas:

CORRECTO:
"Conviene validar cómo se administran los activos
tecnológicos entre las diferentes instalaciones."

INCORRECTO:
"Las plantas tienen problemas de red."

==================================================
REGLAS
==================================================

NO inventes:

- vulnerabilidades;
- ataques;
- malware;
- incidentes;
- fugas;
- tecnologías;
- firewalls;
- VPN;
- nube;
- servidores;
- respaldos;
- problemas;
- deficiencias.

Utiliza solamente IDs existentes.

CATÁLOGO:

${getCompactCatalog()}

Máximo 10 celdas.

==================================================
FORMATO
==================================================

{
  "diagnostico": [
    {
      "area_id": "ID_EXISTENTE",
      "capa_id": "ID_EXISTENTE",
      "prioridad": "alta",
      "motivo": "Motivo basado en hechos.",
      "evidencia": "Dato confirmado.",
      "soluciones": [
        "ID_EXISTENTE"
      ]
    }
  ],
  "conclusion": {
    "resumen": "Resumen breve.",
    "prioridades": [
      "Prioridad"
    ],
    "siguiente_paso": "Siguiente paso."
  }
}

Devuelve únicamente JSON.
`;
}


/*
==================================================
ENRIQUECER DIAGNÓSTICO
==================================================
*/

function enrichDiagnosis(diagnosis) {

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
    Array.isArray(catalog.areas)
      ? catalog.areas
      : [];

  const capas =
    Array.isArray(catalog.capas)
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

  const usedCells =
    new Set();

  for (
    const item of diagnosis
  ) {

    if (
      !item ||
      typeof item !== "object"
    ) {
      continue;
    }

    const area =
      areaMap.get(
        normalize(
          item.area_id ||
          item.area
        )
      );

    const capa =
      capaMap.get(
        normalize(
          item.capa_id ||
          item.capa
        )
      );

    if (
      !area ||
      !capa
    ) {
      continue;
    }

    const cell =
      `${area.id}.${capa.id}`;

    if (
      usedCells.has(
        normalize(cell)
      )
    ) {
      continue;
    }

    usedCells.add(
      normalize(cell)
    );

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
          solutionId => {

            const id =
              typeof solutionId === "string"
                ? solutionId
                : solutionId?.id;

            return solutionMap.get(
              normalize(id)
            );
          }
        )
        .filter(
          solution =>
            solution &&
            covering.some(
              valid =>
                normalize(valid.id) ===
                normalize(solution.id)
            )
        );

    const finalSolutions =
      selected.length > 0
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
        String(
          item.motivo || ""
        ).trim(),

      evidencia:
        String(
          item.evidencia || ""
        ).trim(),

      soluciones:
        finalSolutions.map(
          solution => ({

            id:
              solution.id,

            nombre:
              solution.nombre,

            categoria:
              solution.categoria || "",

            descripcion:
              solution.descripcion || "",

            necesidad_que_atiende:
              solution.necesidad_que_atiende || "",

            que_validar:
              Array.isArray(
                solution.que_validar
              )
                ? solution.que_validar
                : [],

            url:
              solution.url || ""
          })
        )
    });
  }

  return result;
}


/*
==================================================
FALLBACK DETERMINÍSTICO
==================================================

Si Groq no devuelve IDs válidos, el backend todavía
puede construir oportunidades a partir de evidencia real.
==================================================
*/

function buildFallbackDiagnosis(history) {

  const evidence =
    evidenceText(history);

  const text =
    normalize(evidence);

  const results = [];

  const largeOrganization =
    text.includes("1000") ||
    text.includes("1000+") ||
    text.includes("1,000") ||
    text.includes("25000") ||
    text.includes("25,000") ||
    text.includes("multinacional") ||
    text.includes("empleados");

  const manufacturing =
    text.includes("manufactura") ||
    text.includes("manufacturera") ||
    text.includes("fabricacion") ||
    text.includes("fabricación") ||
    text.includes("planta") ||
    text.includes("plantas");

  /*
  ----------------------------------------------
  HOST / ACTIVOS
  ----------------------------------------------
  */

  if (largeOrganization) {

    results.push({

      area_id:
        "host",

      capa_id:
        "activos",

      prioridad:
        "alta",

      motivo:
        "El tamaño de la organización hace relevante validar cómo se administran y protegen los equipos utilizados por los colaboradores.",

      evidencia:
        findEvidence(
          history,
          [
            "empleados",
            "25,000",
            "25.000",
            "1,000",
            "1000"
          ]
        ),

      soluciones: []
    });
  }


  /*
  ----------------------------------------------
  RED / ACTIVOS
  ----------------------------------------------
  */

  if (
    largeOrganization &&
    manufacturing
  ) {

    results.push({

      area_id:
        "red",

      capa_id:
        "activos",

      prioridad:
        "alta",

      motivo:
        "La operación manufacturera y el tamaño de la organización hacen relevante validar cómo se identifican y administran los activos conectados a la red.",

      evidencia:
        findEvidence(
          history,
          [
            "planta",
            "plantas",
            "manufactura",
            "manufacturera"
          ]
        ),

      soluciones: []
    });
  }


  /*
  ----------------------------------------------
  NO TÉCNICA / BUENAS PRÁCTICAS
  ----------------------------------------------
  */

  if (largeOrganization) {

    results.push({

      area_id:
        "no_tecnica",

      capa_id:
        "buenas_practicas",

      prioridad:
        "media",

      motivo:
        "El tamaño y alcance de la organización hacen relevante validar que existan prácticas y procesos de ciberseguridad establecidos de manera consistente.",

      evidencia:
        findEvidence(
          history,
          [
            "multinacional",
            "empleados",
            "paises",
            "países"
          ]
        ),

      soluciones: []
    });
  }


  /*
  ----------------------------------------------
  SEGURIDAD FÍSICA / ACTIVOS
  ----------------------------------------------
  */

  if (manufacturing) {

    results.push({

      area_id:
        "fisica",

      capa_id:
        "activos",

      prioridad:
        "media",

      motivo:
        "La existencia de plantas de manufactura hace relevante validar cómo se controlan y administran físicamente los activos tecnológicos dentro de las instalaciones.",

      evidencia:
        findEvidence(
          history,
          [
            "planta",
            "plantas",
            "manufactura"
          ]
        ),

      soluciones: []
    });
  }


  return enrichDiagnosis(
    results
  );
}


/*
==================================================
GENERAR DIAGNÓSTICO
==================================================
*/

async function generateDiagnosis(history) {

  /*
  ================================================
  PRIMER INTENTO
  ================================================
  */

  const first =
    await askGroq(
      [
        {
          role:
            "system",

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
    "Primer diagnóstico sin celdas válidas."
  );

  console.warn(
    first.raw
  );


  /*
  ================================================
  SEGUNDO INTENTO
  ================================================
  */

  const second =
    await askGroq(
      [
        {
          role:
            "system",

          content:
            diagnosisPrompt(
              history
            )
        },

        {
          role:
            "user",

          content: `
La respuesta anterior no produjo celdas válidas.

Debes devolver CELDAS REALES del catálogo.

ÁREAS VÁLIDAS:

no_tecnica
fisica
perimetraje
red
host
aplicacion
datos

CAPAS VÁLIDAS:

activos
vulnerabilidades
parches
malware
perimetro
respaldos
dlp
buenas_practicas

Ejemplo:

{
  "area_id": "host",
  "capa_id": "activos",
  "prioridad": "media",
  "motivo": "El tamaño de la organización hace relevante validar cómo se administran los equipos.",
  "evidencia": "Cuenta con más de 1,000 empleados directos.",
  "soluciones": []
}

No inventes vulnerabilidades.

Devuelve al menos una celda si existe información empresarial.
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

  console.warn(
    "Segundo diagnóstico sin celdas válidas."
  );


  /*
  ================================================
  FALLBACK
  ================================================
  */

  const fallback =
    buildFallbackDiagnosis(
      history
    );

  if (
    fallback.length > 0
  ) {

    return {

      diagnostico:
        fallback,

      conclusion: {

        resumen:
          "Con la información disponible se identifican áreas que conviene validar debido al tamaño y características operativas de la organización.",

        prioridades: [
          "Administración de activos informáticos",
          "Protección de dispositivos y red",
          "Mejores prácticas de ciberseguridad"
        ],

        siguiente_paso:
          "Validar con el responsable de TI cómo administran actualmente sus activos, dispositivos y controles de seguridad."
      }
    };
  }

  throw new Error(
    "No fue posible generar oportunidades con la información disponible."
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
          Array.isArray(
            item.soluciones
          )
            ? item.soluciones.map(
                solution =>
                  solution.id
              )
            : []
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
Eres un asesor comercial de ciberseguridad.

Explica por qué cada solución seleccionada es pertinente
para la empresa.

DATOS CONFIRMADOS:

${evidenceText(history)}

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

REGLAS:

- No inventes problemas.
- No inventes tecnologías.
- No inventes incidentes.
- No digas que una protección es inexistente.
- No conviertas una oportunidad en una deficiencia confirmada.
- Basa cada explicación en datos confirmados.

Si solamente existe información suficiente para decir
que algo debe validarse, utiliza ese enfoque.

Ejemplo correcto:

"El tamaño de la organización hace pertinente validar
cómo se administran y protegen los equipos."

Ejemplo incorrecto:

"La empresa tiene equipos desprotegidos."

FORMATO:

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
          role:
            "system",

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
        )
          .trim()
          .slice(
            0,
            MAX_MESSAGE_LENGTH
          );

      const userId =
        String(
          req.body?.userId ??
          req.body?.conversationId ??
          "default"
        );

      if (!prompt) {

        return res
          .status(400)
          .json({
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
      ==============================================
      DIAGNÓSTICO
      ==============================================
      */

      if (
        isDiagnosisRequest(
          prompt
        )
      ) {

        /*
        El comando NO se agrega al historial.
        */

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
                      ) ||
                      "La información disponible permite considerar esta solución como una oportunidad a validar; no confirma que exista actualmente una deficiencia."
                  })
                )
            })
          );


        /*
        Guardar diagnóstico como respuesta
        del consejero.
        */

        history.push({

          role:
            "assistant",

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
              resumen:
                "",

              prioridades:
                [],

              siguiente_paso:
                ""
            }
        });
      }


      /*
      ==============================================
      CONVERSACIÓN NORMAL
      ==============================================
      */

      history.push({

        role:
          "user",

        content:
          prompt
      });

      trimHistory(
        history
      );

      const response =
        await generateAdvisorResponse(
          history
        );

      history.push({

        role:
          "assistant",

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

      return res
        .status(500)
        .json({

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
  (
    req,
    res
  ) => {

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

      res
        .status(500)
        .json({
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
  (
    req,
    res
  ) => {

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
  (
    req,
    res
  ) => {

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