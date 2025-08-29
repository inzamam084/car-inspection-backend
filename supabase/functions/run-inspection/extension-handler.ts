import { ImageProcessor, ProcessingMode } from "./image-processor.ts";
import { runAnalysisInBackground } from "./processor.ts";
import { StatusManager } from "./status-manager.ts";
import { runInBackground } from "./utils.ts";
import { Database } from "./database.ts";
import type { ExtensionVehicleData } from "./schemas.ts";
import { RequestContext } from "./logging.ts";

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

    // Create inspection record
    ctx.debug("Creating inspection record from vehicle data");
    const inspectionResult = await Database.createInspectionFromVehicleData(
      vehicleData,
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

    // Combine gallery images with page screenshot if present
    const allImageUrls = [...vehicleData.gallery_images];
    if (vehicleData.page_screenshot?.storageUrl) {
      ctx.debug("Adding page screenshot to processing queue", {
        screenshot_url: vehicleData.page_screenshot.storageUrl,
      });
      allImageUrls.push(vehicleData.page_screenshot.storageUrl);
    }

    ctx.info("Starting hybrid image processing", {
      lot_id: lotId,
      total_images: allImageUrls.length,
    });
    // Use hybrid processing mode for best performance and reliability:
    // - First attempts streaming (memory-efficient for large images)
    // - Falls back to parallel buffering for failed streams
    // - Provides optimal balance of speed, memory usage, and reliability
    const uploadResults = await imageProcessor.processImages(
      allImageUrls,
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
