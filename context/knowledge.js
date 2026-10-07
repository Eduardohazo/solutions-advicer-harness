import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const dataDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "data"
);

const cache = new Map();

export function loadJson(fileName) {
  const filePath = path.join(dataDir, fileName);

  const stats = fs.statSync(filePath);
  const cached = cache.get(fileName);

  if (cached && cached.mtime === stats.mtimeMs) {
    return cached.data;
  }

  const data = JSON.parse(
    fs.readFileSync(filePath, "utf8")
  );

  cache.set(fileName, {
    mtime: stats.mtimeMs,
    data
  });

  return data;
}

export function getCompactCatalogAndSolutions() {
  const catalog = loadJson("catalog.json");
  const solutions = loadJson("solutions.json");

  const areas = Array.isArray(catalog.areas)
    ? catalog.areas
    : [];

  const capas = Array.isArray(catalog.capas)
    ? catalog.capas
    : [];

  const cells = new Map();

  for (const solution of solutions) {
    if (!solution || !Array.isArray(solution.cubre)) {
      continue;
    }

    for (const cell of solution.cubre) {
      if (!cells.has(cell)) {
        cells.set(cell, []);
      }

      cells.get(cell).push(solution.id);
    }
  }

  const cellLines = [];

  for (const [cell, ids] of cells.entries()) {
    cellLines.push(
      `${cell} -> ${ids.join(", ")}`
    );
  }

  return `
CATÁLOGO OFICIAL

ÁREAS:
${areas
  .map(
    area =>
      `- ${area.id}: ${area.nombre}`
  )
  .join("\n")}

CAPAS:
${capas
  .map(
    capa =>
      `- ${capa.id}: ${capa.nombre}`
  )
  .join("\n")}

CELDAS DISPONIBLES:
${cellLines.join("\n")}

REGLA CRÍTICA:
Una solución solamente puede utilizarse si su ID aparece
en la celda correspondiente.

IMPORTANTE:
Cuando generes un diagnóstico, el campo "soluciones"
debe contener ÚNICAMENTE IDs de soluciones del catálogo.

Ejemplo correcto:
"soluciones": ["edr", "dlp"]

Ejemplo incorrecto:
"soluciones": ["EDR / Protección Endpoint"]
"soluciones": ["| EDR | DLP |"]
"soluciones": ["EDR, DLP"]
`;
}

export const personality = {
  role: "system",

  content: `
Eres "Consejero Cero Uno", un copiloto comercial
de ciberseguridad para vendedores de Cero Uno Software Corporativo.

Tu función es ayudar al VENDEDOR a conducir una conversación
comercial consultiva con una empresa prospecto.

REGLAS GENERALES:

- Habla siempre con el vendedor.
- Nunca hables como si fueras el prospecto.
- Sé claro y conciso.
- No muestres razonamiento interno.
- No inventes información.
- No inventes vulnerabilidades.
- No inventes incidentes.
- No inventes productos.
- No inventes funcionalidades.
- No inventes precios.
- No inventes certificaciones.
- No afirmes que existe una deficiencia si el vendedor no la confirmó.
- Puedes identificar una oportunidad potencial cuando exista contexto suficiente.
- Una oportunidad potencial debe expresarse como algo que se debe validar.
- Durante descubrimiento no presentes productos.
- Durante descubrimiento haz solamente UNA pregunta.
- La pregunta debe aprovechar la información proporcionada previamente.
- Evita cuestionarios rígidos.
- Adapta la siguiente pregunta a la respuesta anterior.

OBJETIVO:

Obtener información suficiente para identificar posteriormente
áreas de negocio, capas de seguridad y soluciones que podrían
ser relevantes para la empresa.

ENFOQUE:

No vendas una solución antes de entender el contexto.

Primero comprende:
- cómo opera la empresa;
- qué tan dependiente es de tecnología;
- qué información y sistemas son importantes;
- cómo trabajan sus usuarios;
- qué infraestructura utiliza;
- qué controles de seguridad ya existen;
- dónde existen posibles necesidades;
- qué impacto tendría una falla.

Si ya existe suficiente información o el vendedor solicita
explícitamente un diagnóstico, genera el diagnóstico.
`
};