import { readJson } from "../repositories/json.repository.js";

import {
    catalogSchema,
    solutionsSchema
} from "../models/catalog.model.js";

import { askGroq } from "./grok.service.js";
import { personality } from "../context/personality.js";
import { normalizePriority } from "../utils/normalize.js";

function loadCatalogData() {
    const catalog = catalogSchema.parse(readJson("catalog.json"));
    const solutions = solutionsSchema.parse(readJson("solutions.json"));

    return { catalog, solutions };
}


export function getPublicCatalog() {
    const { catalog } = loadCatalogData();

    return {
        areas: Array.isArray(catalog?.areas)
            ? catalog.areas
            : [],
        capas: Array.isArray(catalog?.capas)
            ? catalog.capas
            : []
    };
}


export function enrichDiagnosis(diagnosis) {
    const { catalog, solutions } = loadCatalogData();

    const areaMap = new Map(catalog.areas.map(item => [item.id, item]));
    const capaMap = new Map(catalog.capas.map(item => [item.id, item]));
    const solutionMap = new Map(solutions.map(item => [item.id, item]));

    const items = Array.isArray(diagnosis?.diagnostico)
        ? diagnosis.diagnostico
        : [];

    const result = [];

    for (const item of items) {
        if (!item || typeof item !== "object") continue;

        const area = areaMap.get(item.area_id);
        const capa = capaMap.get(item.capa_id);

        if (!area || !capa) continue;

        const cellId = `${area.id}.${capa.id}`;

        // Solo se consideran soluciones que cubren esta combinación.
        const covering = solutions.filter(solution =>
            solution.cubre.includes(cellId)
        );

        const requestedIds = Array.isArray(item.soluciones)
            ? item.soluciones
            : [];

        const validRequested = requestedIds.filter(id =>
            typeof id === "string" &&
            covering.some(solution => solution.id === id)
        );

        const selectedIds = validRequested.length
            ? validRequested
            : covering.slice(0, 3).map(solution => solution.id);

        const enrichedSolutions = selectedIds
            .map(id => solutionMap.get(id))
            .filter(Boolean)
            .map(solution => ({
                id: solution.id,
                nombre: solution.nombre || "",
                categoria: solution.categoria || "",
                descripcion: solution.descripcion || "",
                necesidad_que_atiende: solution.necesidad_que_atiende || "",
                que_validar: Array.isArray(solution.que_validar)
                    ? solution.que_validar
                    : [],
                url: solution.url || ""
            }));

        result.push({
            area_id: area.id,
            area_nombre: area.nombre,
            capa_id: capa.id,
            capa_nombre: capa.nombre,
            prioridad: normalizePriority(item.prioridad),
            motivo: typeof item.motivo === "string" ? item.motivo : "",
            evidencia: typeof item.evidencia === "string"
                ? item.evidencia
                : "",
            soluciones: enrichedSolutions
        });
    }

    return result;
}

export async function generateSolutionAnalysis(diagnosis) {
    if (!Array.isArray(diagnosis)) return [];

    for (const item of diagnosis) {
        for (const solution of item.soluciones || []) {
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

Reglas:
- No inventes información.
- No afirmes que existe una vulnerabilidad sin evidencia.
- Si la evidencia es insuficiente, indica que debe validarse.
- Explica por qué la solución podría ser relevante comercialmente.
- Sé breve.
- Devuelve únicamente JSON válido.
`;

            try {
                const result = await askGroq([
                    personality,
                    { role: "user", content: prompt }
                ], 500);

                const explanation = result?.parsed?.por_que_aplica;

                solution.por_que_aplica =
                    typeof explanation === "string" && explanation.trim()
                        ? explanation.trim()
                        : "Conviene validar esta solución con el prospecto para confirmar su aplicabilidad.";
            } catch (error) {
                console.error(
                    "No se pudo analizar una solución:",
                    error?.message || error
                );

                solution.por_que_aplica =
                    "Conviene validar esta solución con el prospecto para confirmar su aplicabilidad.";
            }
        }
    }

    return diagnosis;
}