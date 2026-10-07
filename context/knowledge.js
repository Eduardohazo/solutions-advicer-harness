import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const dir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "data"
);

const cache = new Map();

export function loadJson(fileName) {
  const file = path.join(dir, fileName);
  const mtime = fs.statSync(file).mtimeMs;

  const cached = cache.get(fileName);

  if (cached && cached.mtime === mtime) {
    return cached.data;
  }

  const data = JSON.parse(
    fs.readFileSync(file, "utf8")
  );

  cache.set(fileName, {
    mtime,
    data
  });

  return data;
}

export function getCompactCatalog() {
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
    if (!Array.isArray(solution.cubre)) {
      continue;
    }

    for (const cell of solution.cubre) {
      if (!cells.has(cell)) {
        cells.set(cell, []);
      }

      cells.get(cell).push(solution.id);
    }
  }

  const cellLines = [...cells.entries()].map(
    ([cell, ids]) =>
      `${cell} -> ${ids.join(", ")}`
  );

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

REGLA:
Una solución solamente puede utilizarse si su ID aparece
en la celda correspondiente.
`;
}