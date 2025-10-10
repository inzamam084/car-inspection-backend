import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Logging configuration
const LOG_TAG = "UPLOAD_IMAGE";

function logInfo(message: string, data?: any): void {
  const timestamp = new Date().toISOString();
  console.log(`[${LOG_TAG}] [${timestamp}] INFO: ${message}`, data || "");
}

function logError(message: string, error?: any): void {
  const timestamp = new Date().toISOString();
  console.error(`[${LOG_TAG}] [${timestamp}] ERROR: ${message}`, error || "");
}

function logDebug(message: string, data?: any): void {
  const timestamp = new Date().toISOString();
  console.log(`[${LOG_TAG}] [${timestamp}] DEBUG: ${message}`, data || "");
}

// User agents for requests
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];

/**
 * Get appropriate referer for different auction sites
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
  } catch (error) {
    return "https://www.google.com/";
  }
}

/**
 * Generate a categorized filename for image storage
 */
function generateFilename(originalUrl: string): string {
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(2, 15);
  return `uncategorized_${timestamp}_${randomId}.jpg`;
}

/**
 * Download image into memory buffer (buffered approach)
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

/**
 * Upload image buffer to Supabase storage (buffered approach)
 */
async function uploadBufferedToSupabase(
  supabase: any,
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
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Stream image directly from source to Supabase (streaming approach)
 */
async function uploadStreamingToSupabase(
  supabase: any,
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

    // Stream directly to Supabase
    const { data, error } = await supabase.storage
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
  } catch (error:any) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      return {
        success: false,
        error: `Streaming timeout after ${timeoutMs}ms`,
      };
    }
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Save image metadata to database
 */
async function saveToDatabase(
  supabase: any,
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
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Process image with retry logic
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
        } catch (streamError) {
          logDebug("Streaming failed, falling back to buffered", {
            error: (streamError as Error).message,
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
    } catch (error) {
      lastError = error as Error;

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

// Main handler
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
  } catch (error) {
    const duration = Date.now() - startTime;
    logError("Image upload failed", {
      error: (error as Error).message,
      stack: (error as Error).stack,
      duration_ms: duration,
    });

    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message || "Internal server error",
        duration_ms: duration,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
