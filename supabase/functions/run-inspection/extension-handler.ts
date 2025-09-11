import { ImageProcessor, ProcessingMode } from "./image-processor.ts";
import { runAnalysisInBackground } from "./processor.ts";
import { StatusManager } from "./status-manager.ts";
import { runInBackground } from "./utils.ts";
import { Database } from "./database.ts";
import type { ExtensionVehicleData } from "./schemas.ts";
import { RequestContext } from "./logging.ts";
import { SUPABASE_CONFIG } from "./config.ts";

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
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === config.maxRetries) {
        ctx.error(`${operationName} failed after ${config.maxRetries + 1} attempts`, {
          error: lastError.message,
          totalAttempts: attempt + 1,
        });
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

    // Extract vehicle data from first image using image_data_extract function
    let extractedVehicleData: ImageDataExtractResponse | null = null;
    if (vehicleData.page_screenshot?.storageUrl) {
      ctx.info("Extracting vehicle data from first image", {
        image_url: vehicleData.gallery_images[0],
      });

      try {
        const functionCallPayload = {
          function_name: "image_data_extract",
          query: "Provide the results with the image url",
          inspection_id: undefined, // Inspection hasn't been created yet
          user_id: ctx.userId,
          files: [
            {
              type: "image",
              transfer_method: "remote_url",
              url: vehicleData.page_screenshot?.storageUrl,
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
                  Authorization: `Bearer ${SUPABASE_CONFIG.serviceKey}`,
                },
                body: JSON.stringify(functionCallPayload),
              }
            );

            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const result = await response.json();

            if (!result.success || !result.payload) {
              throw new Error(`Function call failed: ${JSON.stringify(result)}`);
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
          ctx.info(
            "Extracted vehicle data from image",
            extractedVehicleData
          );
          ctx.info("Successfully extracted vehicle data from image", {
            has_vin: !!extractedVehicleData?.Vin,
            has_make: !!extractedVehicleData?.Make,
            has_model: !!extractedVehicleData?.Model,
            has_year: !!extractedVehicleData?.Year,
          });
        } catch (parseError) {
          ctx.error("Failed to parse extracted vehicle data", {
            error: (parseError as Error).message,
            payload: result.payload,
          });
          // Continue with null extractedVehicleData - process will continue
        }
      } catch (error) {
        ctx.warn("Image data extraction failed after retries, continuing with original vehicle data", {
          error: (error as Error).message,
        });
        // Don't throw error - continue with null extractedVehicleData
        // The process will continue using the original vehicleData
      }
    } else {
      ctx.info("No images available for vehicle data extraction");
    }

    // Create inspection record with extracted vehicle data
    ctx.debug("Creating inspection record from vehicle data");
    const inspectionResult = await Database.createInspectionFromVehicleData(
      vehicleData,
      extractedVehicleData,
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
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}
