import { readJson, writeJson } from "./json.repository.js";
import { conversationSchema } from "../models/chat.model.js";

function loadStore() {
  const data = readJson("conversations.json");

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("El archivo de conversaciones tiene una estructura inválida.");
  }

  for (const [userId, history] of Object.entries(data)) {
    if (!userId || !conversationSchema.safeParse(history).success) {
      throw new Error("Se encontró una conversación inválida en el almacenamiento.");
    }
  }

  return data;
}

export function getConversation(userId) {
  const store = loadStore();
  const history = store[userId] ?? [];

  return conversationSchema.parse(history);
}

export function saveConversation(userId, history) {
  const validatedHistory = conversationSchema.parse(history);
  const store = loadStore();

  store[userId] = validatedHistory;

  writeJson("conversations.json", store);
}

export function deleteConversation(userId) {
  const store = loadStore();

  delete store[userId];

  writeJson("conversations.json", store);
}