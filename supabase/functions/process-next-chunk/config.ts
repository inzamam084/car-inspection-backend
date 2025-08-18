import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Configuration constants for the process-next-chunk function
 */

// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
export const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Gemini API Configuration
export const GEMINI_CONFIG = {
  apiKey: Deno.env.get("GEMINI_API_KEY") || "",
  baseUrl: "https://generativelanguage.googleapis.com",
  model: "gemini-2.5-flash",
  uploadUrl: "https://generativelanguage.googleapis.com/upload/v1beta/files",
} as const;

// Dify API Configuration
export const DIFY_CONFIG = {
  apiKey: Deno.env.get("DIFY_WORKFLOW_API_KEY") || "",
  baseUrl: "https://api.dify.ai/v1/workflows/run",
} as const;

// Processing Configuration
export const PROCESSING_CONFIG = {
  // Maximum number of concurrent image uploads
  maxConcurrentUploads: 3,
  // Delay between batches in milliseconds
  batchDelayMs: 2000,
  // Rate limiting settings
  rateLimitDelayMs: 1000,
} as const;

// Supabase Storage Configuration
export const STORAGE_CONFIG = {
  bucketName: "inspection-photos",
} as const;
