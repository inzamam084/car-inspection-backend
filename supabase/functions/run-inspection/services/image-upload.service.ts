import { supabase, SUPABASE_CONFIG } from "../config/supabase.config.ts";
import { logInfo, logError, logDebug } from "../utils/logger.ts";
import { TIMEOUTS, LIMITS, STORAGE } from "../config/constants.ts";

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
];

/**
 * Get referer based on image URL domain
 */
function getRefererForUrl(imageUrl: string): string {
  try {
    const url = new URL(imageUrl);
    return `${url.protocol}//${url.host}/`;
  } catch {
    return "https://www.google.com/";
  }
}

/**
 * Download image from external URL with retry and proper headers
 */
async function downloadImage(
  imageUrl: string,
  timeoutMs: number = TIMEOUTS.IMAGE_DOWNLOAD
): Promise<{ success: boolean; buffer?: Uint8Array; error?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

    const response = await fetch(imageUrl, {
      headers: {
        "User-Agent": userAgent,
        "Referer": getRefererForUrl(imageUrl),
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Cache-Control": "no-cache",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      success: true,
      buffer: new Uint8Array(arrayBuffer),
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      return {
        success: false,
        error: `Download timeout after ${timeoutMs}ms`,
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Upload image buffer to Supabase storage
 */
async function uploadToSupabase(
  buffer: Uint8Array,
  filename: string,
  inspectionId: string
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const uploadPath = `${inspectionId}/${filename}`;

    const { error } = await supabase.storage
      .from("inspection-photos")
      .upload(uploadPath, buffer, {
        contentType: STORAGE.IMAGE_CONTENT_TYPE,
        cacheControl: STORAGE.IMAGE_CACHE_CONTROL,
        upsert: false,
      });

    if (error) {
      return { success: false, error: error.message };
    }

    const { data: urlData } = supabase.storage
      .from("inspection-photos")
      .getPublicUrl(uploadPath);

    return { success: true, url: urlData.publicUrl };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Save image metadata to photos table
 */
async function saveImageToDatabase(
  inspectionId: string,
  publicUrl: string,
  fileSize: number,
  originalUrl: string,
  category: string = "gallery"
): Promise<{ success: boolean; photoId?: string; error?: string }> {
  try {
    const { data, error } = await supabase
      .from("photos")
      .insert({
        inspection_id: inspectionId,
        category: category,
        path: publicUrl,
        image_url: originalUrl,
        storage: fileSize.toString(),
      })
      .select("id")
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, photoId: data.id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Process single image with retry logic
 */
async function processImageWithRetry(
  imageUrl: string,
  inspectionId: string,
  index: number,
  requestId: string,
  maxRetries: number = LIMITS.MAX_IMAGE_RETRIES
): Promise<{ success: boolean; url?: string; error?: string }> {
  const filename = `gallery_${index}_${Date.now()}.jpg`;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        logDebug(requestId, `Retry attempt ${attempt + 1}/${maxRetries} for image ${index}`);
        // Exponential backoff
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }

      // 1. Download image
      const downloadResult = await downloadImage(imageUrl);
      if (!downloadResult.success || !downloadResult.buffer) {
        throw new Error(downloadResult.error || "Download failed");
      }

      // 2. Upload to Supabase
      const uploadResult = await uploadToSupabase(
        downloadResult.buffer,
        filename,
        inspectionId
      );

      if (!uploadResult.success || !uploadResult.url) {
        throw new Error(uploadResult.error || "Upload failed");
      }

      // 3. Save to database
      const dbResult = await saveImageToDatabase(
        inspectionId,
        uploadResult.url,
        downloadResult.buffer.length,
        imageUrl
      );

      if (!dbResult.success) {
        logError(requestId, "Failed to save image to database (continuing)", {
          error: dbResult.error,
        });
        // Continue anyway - we have the image in storage
      }

      logDebug(requestId, `Successfully processed image ${index}`, {
        supabase_url: uploadResult.url,
        size_bytes: downloadResult.buffer.length,
      });

      return { success: true, url: uploadResult.url };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (attempt === maxRetries - 1) {
        logError(requestId, `Failed to process image ${index} after ${maxRetries} attempts`, {
          error: errorMessage,
          original_url: imageUrl,
        });
        return { success: false, error: errorMessage };
      }
    }
  }

  return { success: false, error: "Max retries exceeded" };
}

/**
 * Upload multiple images from Chrome Extension to Supabase
 * @param galleryUrls External image URLs from listing sites
 * @param inspectionId Inspection ID to associate images with
 * @param requestId Request ID for logging
 * @returns Array of Supabase storage URLs for successfully uploaded images
 */
export async function uploadChromeExtensionImages(
  galleryUrls: string[],
  inspectionId: string,
  requestId: string
): Promise<{ success: boolean; urls?: string[]; errors?: string[] }> {
  logInfo(requestId, "Starting Chrome Extension image upload", {
    image_count: galleryUrls.length,
    inspection_id: inspectionId,
  });

  const results = await Promise.all(
    galleryUrls.map((url, index) =>
      processImageWithRetry(url, inspectionId, index, requestId)
    )
  );

  const successfulUrls: string[] = [];
  const errors: string[] = [];

  results.forEach((result, index) => {
    if (result.success && result.url) {
      successfulUrls.push(result.url);
    } else {
      errors.push(`Image ${index}: ${result.error || "Unknown error"}`);
    }
  });

  logInfo(requestId, "Chrome Extension image upload completed", {
    total: galleryUrls.length,
    successful: successfulUrls.length,
    failed: errors.length,
  });

  if (successfulUrls.length === 0) {
    return {
      success: false,
      errors: ["All image uploads failed", ...errors],
    };
  }

  return {
    success: true,
    urls: successfulUrls,
    errors: errors.length > 0 ? errors : undefined,
  };
}
