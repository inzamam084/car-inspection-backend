import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
export const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Base URL for the application
export const APP_BASE_URL =
  Deno.env.get("APP_BASE_URL") || "https://ourfixmate.vercel.app/";

// Category priority for chunking
export const CATEGORY_PRIORITY = [
  "exterior",
  "interior",
  "dashboard",
  "paint",
  "rust",
  "engine",
  "undercarriage",
  "obd",
  "title",
  "records",
];

// Maximum chunk size in bytes (20MB)
export const MAX_CHUNK_SIZE =
  parseInt(Deno.env.get("MAX_CHUNK_SIZE") ?? "", 10) || 20 * 1024 * 1024;

// Cloudinary configuration
export const CLOUDINARY_CLOUD_NAME = "dz0o8yk5i";

// Supabase configuration for external calls
export const SUPABASE_CONFIG = {
  url: supabaseUrl,
  serviceKey: supabaseServiceKey,
};
