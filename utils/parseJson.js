export function parseAgentJson(text) {
  if (typeof text !== "string" || !text.trim()) {
    return null;
  }

  const clean = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(clean);
  } catch {
    // Intenta recuperar un objeto JSON.
  }

  const firstObject = clean.indexOf("{");
  const lastObject = clean.lastIndexOf("}");

  if (firstObject !== -1 && lastObject > firstObject) {
    try {
      return JSON.parse(clean.slice(firstObject, lastObject + 1));
    } catch {
      // Continúa con el intento de recuperar un array.
    }
  }

  const firstArray = clean.indexOf("[");
  const lastArray = clean.lastIndexOf("]");

  if (firstArray !== -1 && lastArray > firstArray) {
    try {
      return JSON.parse(clean.slice(firstArray, lastArray + 1));
    } catch {
      return null;
    }
  }

  return null;
}