import { ImageProcessor, ProcessingMode } from "./image-processor.ts";
import { runAnalysisInBackground } from "./processor.ts";
import { StatusManager } from "./status-manager.ts";
import { runInBackground } from "./utils.ts";
import { Database } from "./database.ts";
import type { ExtensionVehicleData } from "./schemas.ts";
import { RequestContext } from "./logging.ts";
import { SUPABASE_CONFIG } from "./config.ts";
import { supabase } from "./config.ts";

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

/**
 * Helper function to compress image if it's larger than 3MB
 * Extracts storage path from URL and uses Supabase transform API
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

    const maxSizeBytes = 1 * 1024 * 1024; // 3MB

    if (fileSize <= maxSizeBytes) {
      ctx.info("Image size is acceptable, no compression needed", {
        file_size_mb: Math.round((fileSize / 1024 / 1024) * 100) / 100,
      });
      return imageUrl; // Return original URL if under 3MB
    }

    ctx.info("Image size exceeds 3MB, compressing...", {
      original_size_mb: Math.round((fileSize / 1024 / 1024) * 100) / 100,
    });

    // Extract storage path from Supabase URL
    const storageInfo = extractStoragePathFromUrl(imageUrl);
    if (!storageInfo) {
      ctx.warn("Could not extract storage path from URL, using original", {
        url: imageUrl,
      });
      return imageUrl;
    }

    ctx.debug("Extracted storage info", {
      bucket: storageInfo.bucket,
      path: storageInfo.path,
    });

    // Create signed URL with transform to compress
    const { data: signedUrlData, error: signedUrlError } =
      await supabase.storage
        .from(storageInfo.bucket) // Use the extracted bucket name
        .createSignedUrl(storageInfo.path, 300, {
          // 5 minutes expiry
          transform: {
            width: 1280,
            quality: 70,
            // Remove format parameter to allow automatic optimization (WebP detection)
            // Supabase will automatically serve WebP to compatible browsers
          },
        });

    if (signedUrlError) {
      ctx.warn("Failed to create compressed URL, using original", {
        error: signedUrlError.message,
      });
      return imageUrl;
    }

    ctx.info("Successfully created compressed image URL", {
      original_url: imageUrl,
      compressed_url: signedUrlData.signedUrl,
    });

    return signedUrlData.signedUrl;
  } catch (error) {
    ctx.warn("Error during compression attempt, using original URL", {
      error: (error as Error).message,
      original_url: imageUrl,
    });
    return imageUrl;
  }
}

/**
 * Extract storage path from Supabase storage URL
 * Example: https://mdwuqrghdiigjktfhmuc.supabase.co/storage/v1/object/public/inspection-photos/screenshot-1758033756196-1758033758063.png
 * Returns: { bucket: "inspection-photos", path: "screenshot-1758033756196-1758033758063.png" }
 */
function extractStoragePathFromUrl(
  url: string
): { bucket: string; path: string } | null {
  try {
    // Pattern for Supabase storage URLs
    const storageUrlPattern = /\/storage\/v1\/object\/public\/([^\/]+)\/(.+)$/;
    const match = url.match(storageUrlPattern);

    if (match && match[1] && match[2]) {
      return {
        bucket: match[1], // bucket name
        path: match[2], // file path within bucket
      };
    }

    return null;
  } catch (error) {
    console.warn("Failed to extract storage path from URL:", error);
    return null;
  }
}

// Interface for the image data extraction response
interface ImageDataExtractResponse {
  Vin: string | null;
  Fuel: string | null;
  Make: string | null;
  Year: number;
  Model: string | null;
  Engine: string | null;
  Mileage: number;
  Location: string | null;
  "Body Style": string | null;
  Drivetrain: string | null;
  "Title Status": string | null;
  Transmission: string | null;
  "Exterior Color": string | null;
  "Interior Color": string | null;
  FullImageText: string | null;
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
    });

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

    // Step 2: Extract vehicle data from screenshot using the created inspection ID
    let extractedVehicleData: ImageDataExtractResponse | null = null;
    if (vehicleData.page_screenshot?.storageUrl) {
      ctx.info("Extracting vehicle data from page screenshot", {
        inspection_id: inspectionId,
        screenshot_url: vehicleData.page_screenshot.storageUrl,
      });

      try {
        // Compress the image if it's larger than 3MB before sending to image_data_extract
        const processedImageUrl = await compressImageIfNeeded(
          vehicleData.page_screenshot.storageUrl,
          ctx
        );

        const functionCallPayload = {
          function_name: "image_data_extract",
          query: "Provide the results with the image url",
          inspection_id: inspectionId, // Now we have a valid inspection ID
          user_id: ctx.userId,
          files: [
            {
              type: "image",
              transfer_method: "remote_url",
              url: processedImageUrl, // Use the potentially compressed URL
            },
          ],
        };

        // Use retry mechanism for the fetch call
        const result = await retryWithBackoff(
          async () => {
            const response = await fetch(
              `${SUPABASE_CONFIG.url}/functions/v1/function-call`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  // Authorization: `Bearer ${SUPABASE_CONFIG.serviceKey}`,
                },
                body: JSON.stringify(functionCallPayload),
              }
            );

            if (!response.ok) {
              const errorText = await response.text();

              // Check if it's a Google service issue (502 Bad Gateway)
              if (
                response.status >= 500 ||
                errorText.includes("502 Bad Gateway") ||
                errorText.includes("PluginDaemonInnerError")
              ) {
                throw new Error(
                  `Temporary service unavailable (${response.status}): Google Vision API may be experiencing issues`
                );
              }

              throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const result = await response.json();

            if (!result.success || !result.payload) {
              throw new Error(
                `Function call failed: ${JSON.stringify(result)}`
              );
            }

            return result;
          },
          ctx,
          "image_data_extract function call"
        );

        // Process the successful result
        try {
          // Handle JSON wrapped in markdown code blocks
          let jsonString = result.payload;
          if (
            jsonString.startsWith("```json\n") &&
            jsonString.endsWith("\n```")
          ) {
            jsonString = jsonString.slice(8, -4); // Remove ```json\n and \n```
          } else if (
            jsonString.startsWith("```\n") &&
            jsonString.endsWith("\n```")
          ) {
            jsonString = jsonString.slice(4, -4); // Remove ```\n and \n```
          }

          extractedVehicleData = JSON.parse(jsonString);
          ctx.info("Successfully extracted vehicle data from screenshot", {
            inspection_id: inspectionId,
            has_vin: !!extractedVehicleData?.Vin,
            has_make: !!extractedVehicleData?.Make,
            has_model: !!extractedVehicleData?.Model,
            has_year: !!extractedVehicleData?.Year,
            has_mileage: !!extractedVehicleData?.Mileage,
          });

          // Step 3: Update the inspection with extracted vehicle data
          if (extractedVehicleData) {
            ctx.debug("Updating inspection with extracted vehicle data");
            try {
              await Database.updateInspectionStatusWithFields(
                inspectionId,
                "pending", // Keep status as pending during setup
                {
                  vehicle_details: extractedVehicleData,
                  vin: extractedVehicleData.Vin || null,
                  mileage: extractedVehicleData.Mileage || null,
                },
                ctx
              );
              ctx.info("Successfully updated inspection with extracted data", {
                inspection_id: inspectionId,
              });
            } catch (updateError) {
              ctx.warn(
                "Failed to update inspection with extracted data, continuing",
                {
                  inspection_id: inspectionId,
                  error: (updateError as Error).message,
                }
              );
            }
          }
        } catch (parseError) {
          ctx.error("Failed to parse extracted vehicle data", {
            inspection_id: inspectionId,
            error: (parseError as Error).message,
            payload: result.payload,
          });
          // Continue with null extractedVehicleData - process will continue
        }
      } catch (error) {
        ctx.info(
          "Screenshot data extraction failed after retries - continuing without extracted data",
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
    } else {
      ctx.info(
        "No page screenshot available for vehicle data extraction - failing extension inspection",
        {
          inspection_id: inspectionId,
        }
      );

      // // Mark inspection as failed due to missing screenshot
      // await StatusManager.markAsFailed(
      //   inspectionId,
      //   "Screenshot analysis required for extension inspections but no screenshot available"
      // );

      // return {
      //   success: false,
      //   error: "Screenshot analysis required for extension inspections but no screenshot was provided",
      // };
    }

    // Step 4: Update status to processing and start image processing
    // Update status to processing using centralized manager
    ctx.debug("Updating inspection status to processing");
    await StatusManager.updateStatus(inspectionId, "processing");

    // Process images using ImageProcessor
    const imageProcessor = new ImageProcessor();
    const lotId = vehicleData.vin || `lot-${Date.now()}`;

    // Use hybrid processing mode for best performance and reliability:
    // - First attempts streaming (memory-efficient for large images)
    // - Falls back to parallel buffering for failed streams
    // - Provides optimal balance of speed, memory usage, and reliability
    const uploadResults = await imageProcessor.processImages(
      vehicleData.gallery_images,
      lotId,
      inspectionId,
      "inspection-photos",
      ProcessingMode.HYBRID
    );

    const successfulUploads = uploadResults.filter((r) => r.success).length;
    const failedUploads = uploadResults.filter((r) => !r.success).length;

    ctx.info("Image processing completed", {
      successful_uploads: successfulUploads,
      failed_uploads: failedUploads,
    });

    if (successfulUploads === 0) {
      // Update status to failed if no images were processed
      ctx.error("No images were successfully processed");
      await StatusManager.markAsFailed(
        inspectionId,
        "No images were successfully processed"
      );
      return {
        success: false,
        error: "No images were successfully processed",
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
