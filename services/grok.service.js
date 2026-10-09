import Groq from "groq-sdk";

import { env } from "../config/env.js";
import { parseAgentJson } from "../utils/parseJson.js";

const groq = new Groq({
  apiKey: env.groqApiKey
});

async function requestModel(model, messages, maxTokens) {
  const params = {
    model,
    messages,
    temperature: 0.2,
    max_completion_tokens: maxTokens
  };

  if (model.startsWith("openai/gpt-oss")) {
    params.reasoning_effort = "low";
  }

  const response = await groq.chat.completions.create(params);
  const message = response?.choices?.[0]?.message;
  const content = message?.content;

  let raw = "";

  if (typeof content === "string") {
    raw = content;
  } else if (Array.isArray(content)) {
    raw = content
      .map(item => typeof item === "string" ? item : item?.text ?? "")
      .join("");
  }

  if (!raw.trim()) {
    const error = new Error("El modelo no devolvió contenido.");
    error.status = 502;
    throw error;
  }

  const parsed = parseAgentJson(raw);

  if (parsed === null) {
    const error = new Error("La IA no devolvió JSON válido.");
    error.status = 502;
    throw error;
  }

  return { raw, parsed };
}

export async function askGroq(messages, maxTokens = 1500) {
  try {
    return await requestModel(
      env.primaryModel,
      messages,
      maxTokens
    );
  } catch (error) {
    const canFallback =
      error?.status === 429 &&
      env.fallbackModel &&
      env.fallbackModel !== env.primaryModel;

    if (!canFallback) {
      throw error;
    }

    console.warn(
      "Modelo principal limitado. Se utilizará el modelo alternativo."
    );

    return requestModel(
      env.fallbackModel,
      messages,
      maxTokens
    );
  }
}