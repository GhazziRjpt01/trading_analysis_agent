import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// server/.env, not the process cwd, so `npm start` works from any directory.
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(serverRoot, ".env") });

function readPort() {
  const raw = process.env.PORT?.trim() || "5000";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer from 1 to 65535, got ${raw}.`);
  }
  return port;
}

function readAnalysisUrl() {
  const raw = process.env.ANALYSIS_URL?.trim() || "http://127.0.0.1:8000";
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("ANALYSIS_URL must be an absolute URL, for example http://127.0.0.1:8000.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("ANALYSIS_URL must use http or https.");
  }
  return url.origin;
}

function optional(name) {
  return process.env[name]?.trim() || "";
}

function readModel() {
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  if (!/^[A-Za-z0-9._-]+$/.test(model)) {
    throw new Error("OPENAI_MODEL may contain only letters, numbers, dots, underscores, and hyphens.");
  }
  return model;
}

export const config = {
  port: readPort(),
  analysisUrl: readAnalysisUrl(),
  // The chat route reads the key. Do not log it.
  openaiApiKey: optional("OPENAI_API_KEY"),
  openaiModel: readModel(),
  supabaseUrl: optional("SUPABASE_URL"),
  // Service role key. Server only. Never expose this to the client or a VITE_ variable.
  supabaseServiceRoleKey: optional("SUPABASE_SERVICE_ROLE_KEY"),
};

export function supabaseConfigured() {
  const url = config.supabaseUrl;
  const key = config.supabaseServiceRoleKey;
  if (!url || !key) {
    return false;
  }
  if (url.includes("your-project") || key.startsWith("your_")) {
    return false;
  }
  return true;
}

export function openaiConfigured() {
  const key = config.openaiApiKey;
  return Boolean(key) && key !== "your_openai_api_key";
}
