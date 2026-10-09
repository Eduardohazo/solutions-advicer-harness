import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(currentDir, "../data");

const allowedFiles = new Set([
  "catalog.json",
  "solutions.json",
  "conversations.json"
]);

export function readJson(fileName) {
  if (!allowedFiles.has(fileName)) {
    throw new Error("Archivo JSON no autorizado.");
  }

  const filePath = path.join(dataDir, fileName);
  const raw = fs.readFileSync(filePath, "utf8");

  return JSON.parse(raw);
}

export function writeJson(fileName, data) {
  if (!allowedFiles.has(fileName)) {
    throw new Error("Archivo JSON no autorizado.");
  }

  const filePath = path.join(dataDir, fileName);
  const temporaryPath = `${filePath}.tmp`;

  const content = JSON.stringify(data, null, 2);

  fs.writeFileSync(temporaryPath, content, "utf8");
  fs.renameSync(temporaryPath, filePath);
}