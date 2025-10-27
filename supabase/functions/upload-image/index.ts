/**
 * UPLOAD_IMAGE – Supabase Edge Function (Deno)
 * -------------------------------------------------
 *
 * This Edge Function ingests a remote image URL, uploads the image to Supabase Storage using one of
 * three approaches (streaming, buffered, or hybrid), and records a corresponding row in the `photos`
 * table with basic metadata. The function implements retry with exponential backoff, user-agent and
 * referer spoofing for auction/classifieds sites, and returns timing + storage details to the caller.
 *
 * ## Responsibilities
 * 1. Validate request body and handle CORS preflight.
 * 2. Choose the requested upload approach:
 *    - **streaming**: pipe the origin response body directly to Supabase Storage (low memory).
 *    - **buffered**: download origin to memory (Uint8Array) then upload (simple semantics).
 *    - **hybrid**: attempt streaming first; on failure, fall back to buffered.
 * 3. Persist a `photos` row containing: `inspection_id`, `category` (defaults to `uncategorized`),
 *    `path` (public URL), `image_url` (original URL), `storage` (size in bytes as string), `created_at`.
 * 4. Return success payload including `photo_id`, `supabase_url`, `filename`, `file_size`, and
 *    `approach_used` for observability.
 *
 * ## Tables
 * - `photos`
 *   - Inserted fields: `inspection_id`, `category`, `path`, `image_url`, `storage`, `created_at`
 *   - Selected for response: `id`
 *
 * ## Environment Variables
 * - `SUPABASE_URL`: Your Supabase project URL.
 * - `SUPABASE_SERVICE_ROLE_KEY`: Service role key (server-only) used to call Storage and insert DB rows.
 *
 * ## Request (this function)
 * - Method: `POST`
 * - Body: `{ image_url: string, inspection_id: string, approach?: "streaming"|"buffered"|"hybrid", bucket_name?: string }`
 *   - `approach` defaults to `"hybrid"`.
 *   - `bucket_name` defaults to `"inspection-photos"`.
 *
 * ## Response (this function)
 * - `200 OK` on success:
 *   ```json
 *   {
 *     "success": true,
 *     "photo_id": "...",
 *     "supabase_url": "https://.../public/...",
 *     "filename": "uncategorized_...jpg",
 *     "file_size": 123456,
 *     "approach_used": "streaming|buffered|buffered_fallback",
 *     "duration_ms": 1234
 *   }
 *   ```
 * - `400 Bad Request` when required fields are missing.
 * - `500 Internal Server Error` when upload or DB steps fail.
 *
 * ## Error Handling & Logging
 * Structured logs (`INFO`, `DEBUG`, `ERROR`) include a static tag and ISO-8601 timestamp.
 * Errors are propagated to HTTP 500 with a concise message in the `error` field.
 *
 * ## Security Notes
 * - This function requires the service role key to talk to Storage and insert DB rows. Ensure the key
 *   remains server-side only. Do **not** expose this Edge endpoint without an appropriate auth layer
 *   if you want to restrict usage.
 * - The uploaded file path uses `inspection_id/filename`. Ensure `inspection_id` is validated and
 *   not sensitive.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Default CORS headers for cross-origin requests. */
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// --------------------------------------------------
// Logging utilities
// --------------------------------------------------

/** Constant log tag to simplify filtering in logs. */
const LOG_TAG: string = "UPLOAD_IMAGE";

/**
 * Emit an informational log line.
 * @param message Human-readable description.
 * @param data Optional structured context object for debugging.
 */
function logInfo(message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  console.log(`[${LOG_TAG}] [${timestamp}] INFO: ${message}`, data || "");
}

/**
 * Emit an error log line.
 * @param message Human-readable error description.
 * @param error Optional Error or context object.
 */
function logError(message: string, error?: unknown): void {
  const timestamp = new Date().toISOString();
  console.error(`[${LOG_TAG}] [${timestamp}] ERROR: ${message}`, error || "");
}

/**
 * Emit a debug log line.
 * @param message Human-readable debug description.
 * @param data Optional structured context object for debugging.
 */
function logDebug(message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  console.log(`[${LOG_TAG}] [${timestamp}] DEBUG: ${message}`, data || "");
}

// --------------------------------------------------
// User-agent / referer helpers
// --------------------------------------------------

/** Candidate desktop user agents used when fetching remote images. */
const USER_AGENTS: readonly string[] = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
] as const;

/**
 * Compute a reasonable `Referer` header for a given image URL. Some classifieds/auction sites
 * require a valid referer for hotlinking; this helper returns the site root for known hosts.
 * @param url The absolute image URL.
 * @returns A referer URL string.
 */
function getRefererForUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    if (hostname.includes("craigslist")) {
      return "https://craigslist.org/";
    } else if (hostname.includes("copart")) {
      return "https://www.copart.com/";
    } else if (hostname.includes("abetter")) {
      return "https://abetter.bid/";
    } else if (hostname.includes("autobidmaster")) {
      return "https://autobidmaster.com/";
    } else if (hostname.includes("capital-auto-auction")) {
      return "https://www.capital-auto-auction.com/";
    } else if (hostname.includes("salvagebid")) {
      return "https://www.salvagebid.com/";
    } else {
      return `${urlObj.protocol}//${urlObj.hostname}/`;
    }
  } catch (error: unknown) {
    return "https://www.google.com/";
  }
}

// --------------------------------------------------
// Filename & download helpers
// --------------------------------------------------

/**
 * Generate a storage filename prefixed with `uncategorized_` followed by a timestamp and random
 * suffix. The extension is always `.jpg` for consistency.
 * @param originalUrl The source URL (not currently used in generation, reserved for future use).
 */
function generateFilename(originalUrl: string): string {
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(2, 15);
  return `uncategorized_${timestamp}_${randomId}.jpg`;
}

/**
 * Download the image into memory (buffered approach) using a desktop user-agent and a computed
 * referer. This is a fallback-friendly, simple method but incurs memory usage equal to image size.
 * @param url Absolute image URL to download.
 * @throws If the origin server responds with a non-2xx status.
 * @returns Raw bytes as a `Uint8Array`.
 */
async function downloadImageBuffered(url: string): Promise<Uint8Array> {
  const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

  const response = await fetch(url, {
    headers: {
      "User-Agent": userAgent,
      "Referer": getRefererForUrl(url),
      "Accept":
        "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

// --------------------------------------------------
// Supabase Storage interactions
// --------------------------------------------------

/**
 * Upload an in-memory buffer to Supabase Storage.
 * @param supabase Supabase service-role client.
 * @param imageBuffer Raw image bytes.
 * @param filename Target filename (no leading slash).
 * @param inspectionId Used to build the upload path: `${inspectionId}/${filename}`.
 * @param bucketName Storage bucket name.
 * @returns `{ success, url?, error? }` with the public URL on success.
 */
async function uploadBufferedToSupabase(
  supabase: ReturnType<typeof createClient>,
  imageBuffer: Uint8Array,
  filename: string,
  inspectionId: string,
  bucketName: string
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const uploadPath = `${inspectionId}/${filename}`;

    const { data, error } = await supabase.storage
      .from(bucketName)
      .upload(uploadPath, imageBuffer, {
        contentType: "image/jpeg",
        cacheControl: "3600",
        upsert: false,
      });

    if (error) {
      return { success: false, error: error.message };
    }

    const { data: urlData } = supabase.storage
      .from(bucketName)
      .getPublicUrl(uploadPath);

    return { success: true, url: urlData.publicUrl };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Stream an image directly from the origin server into Supabase Storage, minimizing memory usage.
 * Supports an abort timeout for slow servers.
 * @param supabase Supabase service-role client.
 * @param imageUrl Absolute image URL.
 * @param filename Target filename.
 * @param inspectionId Used to build `${inspectionId}/${filename}`.
 * @param bucketName Storage bucket name.
 * @param timeoutMs Optional timeout (default 45s) after which the request aborts.
 * @returns `{ success, url?, error?, fileSize? }` with public URL and size when available.
 */
async function uploadStreamingToSupabase(
  supabase: ReturnType<typeof createClient>,
  imageUrl: string,
  filename: string,
  inspectionId: string,
  bucketName: string,
  timeoutMs: number = 45000
): Promise<{ success: boolean; url?: string; error?: string; fileSize?: number }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

    const response = await fetch(imageUrl, {
      headers: {
        "User-Agent": userAgent,
        "Referer": getRefererForUrl(imageUrl),
        "Accept":
          "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Cache-Control": "no-cache",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error("No response body available for streaming");
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const contentLength = response.headers.get("content-length");
    const fileSize = contentLength ? parseInt(contentLength) : 0;

    const uploadPath = `${inspectionId}/${filename}`;

    // Pipe origin stream to Supabase Storage
    const { error } = await supabase.storage
      .from(bucketName)
      .upload(uploadPath, response.body, {
        contentType: contentType,
        cacheControl: "3600",
        upsert: false,
      });

    if (error) {
      throw new Error(`Supabase streaming upload failed: ${error.message}`);
    }

    const { data: urlData } = supabase.storage
      .from(bucketName)
      .getPublicUrl(uploadPath);

    clearTimeout(timeoutId);

    return {
      success: true,
      url: urlData.publicUrl,
      fileSize: fileSize,
    };
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      return {
        success: false,
        error: `Streaming timeout after ${timeoutMs}ms`,
      };
    }
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// --------------------------------------------------
// Database persistence
// --------------------------------------------------

/**
 * Insert a newly uploaded photo row into the `photos` table.
 * @param supabase Supabase service-role client.
 * @param inspectionId Inspection foreign key.
 * @param publicUrl Public URL returned from Storage upload.
 * @param fileSize File size in bytes (0 if unknown during streaming without content-length).
 * @param originalImageUrl The original source URL (kept for traceability).
 * @returns `{ success, photoId?, error? }`.
 */
async function saveToDatabase(
  supabase: ReturnType<typeof createClient>,
  inspectionId: string,
  publicUrl: string,
  fileSize: number,
  originalImageUrl: string
): Promise<{ success: boolean; photoId?: string; error?: string }> {
  try {
    const { data, error: insertError } = await supabase
      .from("photos")
      .insert({
        inspection_id: inspectionId,
        category: "uncategorized",
        path: publicUrl,
        image_url: originalImageUrl,
        storage: fileSize.toString(),
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insertError) {
      return { success: false, error: insertError.message };
    }

    return { success: true, photoId: data.id };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// --------------------------------------------------
// Orchestration with retries
// --------------------------------------------------

/**
 * Process a single image upload with the specified approach. Implements retry with exponential
 * backoff across the entire operation, including storage upload and DB insert.
 *
 * @param supabase Supabase service-role client.
 * @param imageUrl Absolute source image URL.
 * @param inspectionId Inspection ID for both storage path and DB linkage.
 * @param bucketName Storage bucket name.
 * @param approach One of `"streaming" | "buffered" | "hybrid"`.
 * @param maxRetries Number of attempts before giving up (default 3).
 * @returns On success, `{ success: true, supabaseUrl, photoId, filename, fileSize, approach_used }`.
 *          On failure, `{ success: false, error }`.
 */
async function processImageWithRetry(
  supabase: any,
  imageUrl: string,
  inspectionId: string,
  bucketName: string,
  approach: string,
  maxRetries: number = 3
): Promise<{
  success: boolean;
  supabaseUrl?: string;
  photoId?: string;
  filename?: string;
  fileSize?: number;
  error?: string;
  approach_used?: string;
}> {
  const filename = generateFilename(imageUrl);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (approach === "streaming") {
        // Streaming approach
        const uploadResult = await uploadStreamingToSupabase(
          supabase,
          imageUrl,
          filename,
          inspectionId,
          bucketName
        );

        if (!uploadResult.success || !uploadResult.url) {
          throw new Error(uploadResult.error || "Streaming upload failed");
        }

        const dbResult = await saveToDatabase(
          supabase,
          inspectionId,
          uploadResult.url,
          uploadResult.fileSize || 0,
          imageUrl
        );

        if (!dbResult.success) {
          throw new Error(`Database save failed: ${dbResult.error}`);
        }

        return {
          success: true,
          supabaseUrl: uploadResult.url,
          photoId: dbResult.photoId,
          filename: filename,
          fileSize: uploadResult.fileSize,
          approach_used: "streaming",
        };
      } else if (approach === "buffered") {
        // Buffered approach
        const imageBuffer = await downloadImageBuffered(imageUrl);
        const uploadResult = await uploadBufferedToSupabase(
          supabase,
          imageBuffer,
          filename,
          inspectionId,
          bucketName
        );

        if (!uploadResult.success || !uploadResult.url) {
          throw new Error(uploadResult.error || "Buffered upload failed");
        }

        const dbResult = await saveToDatabase(
          supabase,
          inspectionId,
          uploadResult.url,
          imageBuffer.length,
          imageUrl
        );

        if (!dbResult.success) {
          throw new Error(`Database save failed: ${dbResult.error}`);
        }

        return {
          success: true,
          supabaseUrl: uploadResult.url,
          photoId: dbResult.photoId,
          filename: filename,
          fileSize: imageBuffer.length,
          approach_used: "buffered",
        };
      } else if (approach === "hybrid") {
        // Hybrid: try streaming first, fallback to buffered
        try {
          const streamResult = await uploadStreamingToSupabase(
            supabase,
            imageUrl,
            filename,
            inspectionId,
            bucketName
          );

          if (streamResult.success && streamResult.url) {
            const dbResult = await saveToDatabase(
              supabase,
              inspectionId,
              streamResult.url,
              streamResult.fileSize || 0,
              imageUrl
            );

            if (dbResult.success) {
              return {
                success: true,
                supabaseUrl: streamResult.url,
                photoId: dbResult.photoId,
                filename: filename,
                fileSize: streamResult.fileSize,
                approach_used: "streaming",
              };
            }
          }
        } catch (streamError: unknown) {
          logDebug("Streaming failed, falling back to buffered", {
            error: streamError instanceof Error ? streamError.message : String(streamError),
          });
        }

        // Fallback to buffered
        const imageBuffer = await downloadImageBuffered(imageUrl);
        const uploadResult = await uploadBufferedToSupabase(
          supabase,
          imageBuffer,
          filename,
          inspectionId,
          bucketName
        );

        if (!uploadResult.success || !uploadResult.url) {
          throw new Error(uploadResult.error || "Buffered upload failed");
        }

        const dbResult = await saveToDatabase(
          supabase,
          inspectionId,
          uploadResult.url,
          imageBuffer.length,
          imageUrl
        );

        if (!dbResult.success) {
          throw new Error(`Database save failed: ${dbResult.error}`);
        }

        return {
          success: true,
          supabaseUrl: uploadResult.url,
          photoId: dbResult.photoId,
          filename: filename,
          fileSize: imageBuffer.length,
          approach_used: "buffered_fallback",
        };
      } else {
        throw new Error(
          `Invalid approach: ${approach}. Must be 'streaming', 'buffered', or 'hybrid'`
        );
      }
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries - 1) {
        const delay = 1000 * Math.pow(2, attempt); // Exponential backoff
        logDebug(`Attempt ${attempt + 1} failed, retrying in ${delay}ms`, {
          error: lastError.message,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  return {
    success: false,
    error: lastError?.message || "Max retries exceeded",
  };
}

// --------------------------------------------------
// HTTP entrypoint
// --------------------------------------------------

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    // Parse request body
    const body = await req.json();
    const {
      image_url,
      inspection_id,
      approach = "hybrid", // 'streaming', 'buffered', or 'hybrid'
      bucket_name = "inspection-photos",
    } = body;

    logInfo("Upload image request received", {
      image_url: image_url?.substring(0, 50) + "...",
      inspection_id,
      approach,
      bucket_name,
    });

    // Validate required fields
    if (!image_url || !inspection_id) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required fields: image_url, inspection_id",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    logDebug("Processing image upload", {
      approach,
      inspection_id,
    });

    // Process image with retry logic
    const result = await processImageWithRetry(
      supabase,
      image_url,
      inspection_id,
      bucket_name,
      approach
    );

    const duration = Date.now() - startTime;

    if (result.success) {
      logInfo("Image upload completed successfully", {
        photo_id: result.photoId,
        filename: result.filename,
        file_size: result.fileSize,
        approach_used: result.approach_used,
        duration_ms: duration,
      });

      return new Response(
        JSON.stringify({
          success: true,
          photo_id: result.photoId,
          supabase_url: result.supabaseUrl,
          filename: result.filename,
          file_size: result.fileSize,
          approach_used: result.approach_used,
          duration_ms: duration,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    } else {
      logError("Image upload failed", {
        error: result.error,
        duration_ms: duration,
      });

      return new Response(
        JSON.stringify({
          success: false,
          error: result.error,
          duration_ms: duration,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  } catch (error: unknown) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    logError("Image upload failed", {
      error: errorMessage,
      stack: errorStack,
      duration_ms: duration,
    });

    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage || "Internal server error",
        duration_ms: duration,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
