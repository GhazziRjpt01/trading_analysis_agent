import { createClient } from "@supabase/supabase-js";

const url = (import.meta.env.VITE_SUPABASE_URL || "").trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();

export const supabaseAuthProblem = authProblem(url, anonKey);

export const supabase = supabaseAuthProblem ? null : createClient(url, anonKey);

function authProblem(projectUrl, key) {
  if (!projectUrl || !key || projectUrl.includes("your-project") || key.startsWith("your_")) {
    return "Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to client/.env.";
  }
  if (key.startsWith("sb_secret_") || jwtRole(key) === "service_role") {
    return "Use the publishable anon key. Do not put the service role key in a VITE_ variable.";
  }
  return "";
}

function jwtRole(key) {
  const payload = key.split(".")[1];
  if (!payload) {
    return "";
  }
  try {
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const json = JSON.parse(atob(padded.replace(/-/g, "+").replace(/_/g, "/")));
    return json.role || "";
  } catch {
    return "";
  }
}
