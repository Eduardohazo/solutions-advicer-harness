import dotenv from "dotenv";

dotenv.config();

export const env = {
  port: Number(process.env.PORT) || 3000,

  groqApiKey: process.env.GROQ_API_KEY,

  primaryModel:
    process.env.GROQ_MODEL || "openai/gpt-oss-120b",

  fallbackModel:
    process.env.GROQ_FALLBACK_MODEL || "openai/gpt-oss-20b",

  maxHistory: 30,
  maxMessageLength: 6000
};

if (!env.groqApiKey) {
  throw new Error("Falta GROQ_API_KEY en el archivo .env");
}