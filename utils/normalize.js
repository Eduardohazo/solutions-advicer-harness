export function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizePriority(value) {
  const normalized = normalize(value);

  if (["alta", "high", "critica", "critical"].includes(normalized)) {
    return "alta";
  }

  if (["media", "medium"].includes(normalized)) {
    return "media";
  }

  return "baja";
}