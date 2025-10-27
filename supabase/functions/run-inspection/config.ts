import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
export const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Base URL for the application
export const APP_BASE_URL =
  Deno.env.get("APP_BASE_URL") || "https://ourfixmate.vercel.app/";

// Supabase configuration for external calls
export const SUPABASE_CONFIG = {
  url: supabaseUrl,
  serviceKey: supabaseServiceKey,
};

// Dify configuration
export const DIFY_CONFIG = {
  apiUrl: Deno.env.get("DIFY_API_URL") || "https://api.dify.ai/v1",
  apiKey: Deno.env.get("DIFY_API_KEY") || "",
};
