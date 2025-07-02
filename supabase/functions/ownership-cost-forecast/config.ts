import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Environment configuration
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "AIzaSyAy2pqtvdM_h_t-a3TtgkNAFKV8cetlB0g";
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.0-flash-exp";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Initialize Supabase client
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Gemini API configuration
export const geminiConfig = {
  endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
  headers: {
    "Content-Type": "application/json",
    "x-goog-api-key": GEMINI_API_KEY
  },
  rates: {
    promptTokenRate: 0.00015 / 1000,
    completionTokenRate: 0.0006 / 1000
  }
};
