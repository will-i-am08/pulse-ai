import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Service-role client for server-side use ONLY (worker + webhook routes).
// Bypasses RLS — never import into browser code.
let service: SupabaseClient | null = null;

export function serviceClient(): SupabaseClient {
  if (service) return service;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the service client");
  }
  service = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return service;
}

export const MEDIA_BUCKET = "brand-media";
