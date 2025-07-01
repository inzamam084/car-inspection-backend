import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Environment configuration
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") || "https://ourfixmate.vercel.app/";

// Initialize Supabase client
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Application configuration
export const appConfig = {
  baseUrl: APP_BASE_URL,
  aiModel: "gpt-4.1"
};
