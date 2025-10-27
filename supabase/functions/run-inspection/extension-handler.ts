import { runAnalysisInBackground } from "./processor.ts";
import { StatusManager } from "./status-manager.ts";
import { runInBackground } from "./utils.ts";
import { Database } from "./database.ts";
import type { ExtensionVehicleData } from "./schemas.ts";
import { RequestContext } from "./logging.ts";
import { SUPABASE_CONFIG, DIFY_CONFIG } from "./config.ts";

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000, // Start with 1 second
  maxDelayMs: 10000, // Cap at 10 seconds
  backoffMultiplier: 2,
};

// Helper function for retry with exponential backoff
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  ctx: RequestContext,
  operationName: string,
  config = RETRY_CONFIG
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = Math.min(
          config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt - 1),
          config.maxDelayMs
        );

        ctx.info(`Retrying ${operationName}`, {
          attempt: attempt + 1,
          maxRetries: config.maxRetries + 1,
          delayMs: delay,
        });

        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      return await operation();
    } catch (error) {
      lastError = error as Error;

      if (attempt === config.maxRetries) {
        ctx.error(
          `${operationName} failed after ${config.maxRetries + 1} attempts`,
          {
            error: lastError.message,
            totalAttempts: attempt + 1,
          }
        );
        throw lastError;
      }

      ctx.warn(`${operationName} failed, will retry`, {
        attempt: attempt + 1,
        error: lastError.message,
        nextRetryIn: Math.min(
          config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt),
          config.maxDelayMs
        ),
      });
    }
  }

  throw lastError!;
}

// Interface for the compression API response
interface CompressionApiResponse {
  success: boolean;
  compressedUrl: string;
  storagePath: string;
  imageDetails: {
    originalSize: number;
    compressedSize: number;
    width: number;
    height: number;
    format: string;
    compressionRatio: number;
  };
  message: string;
}

/**
 * Helper function to compress image if it's larger than 2MB
 * Uses external compression API: https://fixpilot.ai/api/compress-image
 */
async function compressImageIfNeeded(
  imageUrl: string,
  ctx: RequestContext
): Promise<string> {
  try {
    // First check if we need to compress by getting file size
    const headResponse = await fetch(imageUrl, { method: "HEAD" });
    const contentLength = headResponse.headers.get("content-length");
    const fileSize = contentLength ? parseInt(contentLength) : 0;

    const maxSizeBytes = 2 * 1024 * 1024; // 2MB

    if (fileSize <= maxSizeBytes) {
      ctx.info("Image size is acceptable, no compression needed", {
        file_size_mb: Math.round((fileSize / 1024 / 1024) * 100) / 100,
      });
      return imageUrl; // Return original URL if under 2MB
    }

    ctx.info("Image size exceeds 2MB, compressing...", {
      original_size_mb: Math.round((fileSize / 1024 / 1024) * 100) / 100,
    });

    // Call external compression API
    const compressionPayload = {
      imageUrl: imageUrl,
      quality: 80,
    };

    const compressionResponse = await fetch(
      "https://fixpilot.ai/api/compress-image",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(compressionPayload),
      }
    );

    if (!compressionResponse.ok) {
      const errorText = await compressionResponse.text();
      ctx.warn("Compression API failed, using original URL", {
        status: compressionResponse.status,
        error: errorText,
        original_url: imageUrl,
      });
      return imageUrl;
    }

    const compressionResult: CompressionApiResponse =
      await compressionResponse.json();

    if (!compressionResult.success || !compressionResult.compressedUrl) {
      ctx.warn(
        "Compression API returned unsuccessful result, using original URL",
        {
          result: compressionResult,
          original_url: imageUrl,
        }
      );
      return imageUrl;
    }

    ctx.info("Successfully compressed image using external API", {
      original_url: imageUrl,
      compressed_url: compressionResult.compressedUrl,
      original_size_mb:
        Math.round(
          (compressionResult.imageDetails.originalSize / 1024 / 1024) * 100
        ) / 100,
      compressed_size_mb:
        Math.round(
          (compressionResult.imageDetails.compressedSize / 1024 / 1024) * 100
        ) / 100,
      compression_ratio: compressionResult.imageDetails.compressionRatio,
      message: compressionResult.message,
    });

    return compressionResult.compressedUrl;
  } catch (error) {
    ctx.warn("Error during compression attempt, using original URL", {
      error: (error as Error).message,
      original_url: imageUrl,
    });
    return imageUrl;
  }
}

/**
 * Call Dify workflow for image data extraction from screenshot
 * Note: The workflow handles all data extraction and database updates
 */
async function callDifyWorkflowForScreenshot(
  screenshotUrl: string,
  inspectionId: string,
  userId: string,
  ctx: RequestContext
): Promise<void> {
  ctx.info("Calling Dify workflow for vehicle data extraction", {
    inspection_id: inspectionId,
    screenshot_url: screenshotUrl,
  });

  // Compress the image if needed
  const processedImageUrl = await compressImageIfNeeded(screenshotUrl, ctx);

  const response = await fetch(`https://api.dify.ai/v1/workflows/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer app-DglKtIYlrfPCVnoV7MAeMMRG`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: {
        image: {
          type: "image",
          transfer_method: "remote_url",
          url: processedImageUrl,
        },
        inspection_id: inspectionId,
        user_id: userId,
        type: "categorization", // Type field for categorization flow
      },
      response_mode: "blocking",
      user: userId,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Dify workflow failed: HTTP ${response.status}: ${errorText}`
    );
  }

  const result = await response.json();

  ctx.info("Dify workflow completed for vehicle data extraction", {
    inspection_id: inspectionId,
    workflow_run_id: result.workflow_run_id,
    status: result.data?.status,
  });
}

/**
 * Upload images concurrently using upload-image endpoint
 */
async function uploadImagesConcurrently(
  imageUrls: string[],
  inspectionId: string,
  bucketName: string,
  approach: string,
  ctx: RequestContext
): Promise<{ successCount: number; failedCount: number }> {
  const startTime = Date.now();

  ctx.info("Starting concurrent image uploads via endpoint", {
    total_images: imageUrls.length,
    approach,
    bucket_name: bucketName,
  });

  const uploadPromises = imageUrls.map(async (imageUrl, index) => {
    try {
      const response = await fetch(
        `${SUPABASE_CONFIG.url}/functions/v1/upload-image`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_CONFIG.serviceKey}`,
          },
          body: JSON.stringify({
            image_url: imageUrl,
            inspection_id: inspectionId,
            approach: approach,
            bucket_name: bucketName,
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Upload-image failed: HTTP ${response.status}: ${errorText}`
        );
      }

      const result = await response.json();

      ctx.debug(`Image ${index + 1}/${imageUrls.length} uploaded`, {
        photo_id: result.photo_id,
        filename: result.filename,
        file_size: result.file_size,
        approach_used: result.approach_used,
        duration_ms: result.duration_ms,
      });

      return { success: true, ...result };
    } catch (error) {
      ctx.error(`Failed to upload image ${index + 1}`, {
        image_url: imageUrl.substring(0, 50) + "...",
        error: (error as Error).message,
      });
      return { success: false, error: (error as Error).message };
    }
  });

  // Execute all uploads concurrently
  const results = await Promise.allSettled(uploadPromises);

  // Process results
  const successCount = results.filter(
    (r) => r.status === "fulfilled" && r.value.success
  ).length;
  const failedCount = results.filter(
    (r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.success)
  ).length;

  const duration = Date.now() - startTime;

  ctx.info("Concurrent image uploads completed", {
    total_images: imageUrls.length,
    successful: successCount,
    failed: failedCount,
    duration_ms: duration,
    avg_per_image_ms: Math.round(duration / imageUrls.length),
  });

  return { successCount, failedCount };
}

export async function processExtensionData(
  vehicleData: ExtensionVehicleData,
  ctx: RequestContext
): Promise<{
  success: boolean;
  inspectionId?: string;
  error?: string;
}> {
  try {
    ctx.info("Processing extension data", {
      make: vehicleData.make,
      model: vehicleData.model,
      year: vehicleData.year,
      images_count: vehicleData.gallery_images.length,
      has_page_screenshot: !!vehicleData.page_screenshot?.storageUrl,
      has_extracted_content: !!vehicleData.extracted_content,
    });

    // Log extracted content details if present
    if (vehicleData.extracted_content?.complete?.content) {
      ctx.info("Extension data includes extracted content", {
        platform:
          vehicleData.extracted_content.extraction_metadata?.platform ||
          "unknown",
        content_length: vehicleData.extracted_content.complete.content.length,
        word_count: vehicleData.extracted_content.complete.wordCount || 0,
        content_preview:
          vehicleData.extracted_content.complete.content.substring(0, 100) +
          (vehicleData.extracted_content.complete.content.length > 100
            ? "..."
            : ""),
      });
    }

    // Step 1: Create inspection record first with basic vehicle data
    ctx.debug("Creating inspection record with basic vehicle data");
    const inspectionResult = await Database.createInspectionFromVehicleData(
      vehicleData,
      null, // No extracted data yet
      ctx
    );

    if (!inspectionResult.success || !inspectionResult.inspectionId) {
      ctx.error("Failed to create inspection", {
        error: inspectionResult.error,
      });
      return {
        success: false,
        error: inspectionResult.error || "Failed to create inspection",
      };
    }

    const inspectionId = inspectionResult.inspectionId;
    ctx.setInspection(inspectionId);
    ctx.info("Created inspection successfully", {
      inspection_id: inspectionId,
    });

    // Step 2: Extract vehicle data from screenshot using Dify workflow
    // Note: The Dify workflow handles all data extraction and database updates
    if (vehicleData.page_screenshot?.storageUrl) {
      ctx.info("Processing page screenshot using Dify workflow", {
        inspection_id: inspectionId,
        screenshot_url: vehicleData.page_screenshot.storageUrl,
      });

      try {
        // Use retry mechanism for the Dify workflow call
        await retryWithBackoff(
          async () => {
            await callDifyWorkflowForScreenshot(
              vehicleData.page_screenshot!.storageUrl,
              inspectionId,
              ctx.userId || "anonymous",
              ctx
            );
          },
          ctx,
          "Dify workflow for vehicle data extraction"
        );

        ctx.info("Successfully processed screenshot with Dify workflow", {
          inspection_id: inspectionId,
        });
      } catch (error) {
        ctx.error(
          "Screenshot data extraction failed after retries",
          {
            inspection_id: inspectionId,
            error: (error as Error).message,
          }
        );

        // Mark inspection as failed due to screenshot analysis failure
        await StatusManager.markAsFailed(
          inspectionId,
          `Screenshot analysis failed: ${(error as Error).message}`
        );

        return {
          success: false,
          error: `Screenshot analysis required for extension inspections failed: ${
            (error as Error).message
          }`,
        };
      }
    }

    // Step 3: Update status to processing and start image processing
    ctx.debug("Updating inspection status to processing");
    await StatusManager.updateStatus(inspectionId, "processing");

    // Upload images using concurrent upload-image endpoint calls
    const uploadResults = await uploadImagesConcurrently(
      vehicleData.gallery_images,
      inspectionId,
      "inspection-photos",
      "hybrid", // Use hybrid approach (streaming with buffered fallback)
      ctx
    );

    ctx.info("Image upload processing completed", {
      successful_uploads: uploadResults.successCount,
      failed_uploads: uploadResults.failedCount,
    });

    if (uploadResults.successCount === 0) {
      // Update status to failed if no images were processed
      ctx.error("No images were successfully uploaded");
      await StatusManager.markAsFailed(
        inspectionId,
        "No images were successfully uploaded"
      );
      return {
        success: false,
        error: "No images were successfully uploaded",
      };
    }

    // Start analysis pipeline in background
    ctx.info("Starting analysis pipeline in background");

    runInBackground(async () => {
      try {
        await runAnalysisInBackground(inspectionId, ctx);
      } catch (error) {
        ctx.error("Background analysis failed", {
          inspection_id: inspectionId,
          error: (error as Error).message,
        });
        await StatusManager.markAsFailed(
          inspectionId,
          `Analysis failed: ${(error as Error).message}`
        );
      }
    });

    return {
      success: true,
      inspectionId: inspectionId,
    };
  } catch (error) {
    ctx.error("Error processing extension data", {
      error: (error as Error).message,
    });

    // If we have an inspection ID, mark it as failed
    if (ctx.inspectionId) {
      try {
        await StatusManager.markAsFailed(
          ctx.inspectionId,
          `Extension processing failed: ${(error as Error).message}`
        );
      } catch (statusError) {
        ctx.error("Failed to update inspection status to failed", {
          inspection_id: ctx.inspectionId,
          error: (statusError as Error).message,
        });
      }
    }

    return {
      success: false,
      error: (error as Error).message,
    };
  }
}
