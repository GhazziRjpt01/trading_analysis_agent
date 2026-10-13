import { createClient } from "@supabase/supabase-js";
import { config, supabaseConfigured } from "../config.js";
import { HttpError } from "../errors.js";

let admin;

export function requireSupabase() {
  if (!supabaseConfigured()) {
    throw new HttpError(503, "Supabase is not configured.");
  }
}

export function supabaseAdmin() {
  requireSupabase();
  if (!admin) {
    admin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return admin;
}

export function bearerToken(header) {
  if (typeof header !== "string") {
    return "";
  }
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : "";
}

/**
 * The user id comes from the access token. Callers must not trust a body user_id.
 */
export async function requireUser(req, getUser = defaultGetUser) {
  const token = bearerToken(req.get("authorization"));
  if (!token) {
    throw new HttpError(401, "Sign in required.");
  }
  requireSupabase();
  const user = await getUser(token);
  if (!user?.id) {
    throw new HttpError(401, "Sign in required.");
  }
  return user;
}

async function defaultGetUser(token) {
  const { data, error } = await supabaseAdmin().auth.getUser(token);
  if (error || !data?.user) {
    return null;
  }
  return data.user;
}

export function mapSupabaseError(error) {
  if (error?.code === "23505") {
    return new HttpError(409, "That symbol is already on the watchlist.");
  }
  console.error(`supabase ${error?.code || "error"}`);
  return new HttpError(502, "Supabase is unavailable.");
}
