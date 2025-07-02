import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { OpenAI } from "https://esm.sh/openai@4.87.3";

// Environment configuration
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Initialize OpenAI client
export const openai = new OpenAI({
  apiKey: OPENAI_API_KEY
});

// Initialize Supabase client
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// OpenAI API configuration
export const openaiConfig = {
  model: "gpt-4.1",
  rates: {
    promptTokenRate: 0.01 / 1000,
    completionTokenRate: 0.03 / 1000
  }
};
