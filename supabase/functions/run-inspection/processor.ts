import { APP_BASE_URL, SUPABASE_CONFIG } from "./config.ts";
import { categorizeImages } from "./categorization.ts";
import { Database } from "./database.ts";
import type { Inspection } from "./schemas.ts";
import { RequestContext } from "./logging.ts";

// Background analysis function
export async function runAnalysisInBackground(
  inspectionId: string,
  ctx: RequestContext
): Promise<void> {
  try {
    ctx.info("Starting background analysis", { inspection_id: inspectionId });

    // Update status to processing
    ctx.debug("Updating inspection status to processing");
    await Database.updateInspectionStatus(inspectionId, "processing");

    // Batch fetch all inspection data in a single query
    ctx.debug("Fetching inspection data from database");
    const { data: inspectionData, error: inspectionError } =
      await Database.batchFetchInspectionData(inspectionId);

    if (inspectionError || !inspectionData) {
      ctx.error("Error fetching inspection data", {
        error: inspectionError?.message,
      });
      await Database.updateInspectionStatus(inspectionId, "failed");
      return;
    }

    // Extract data from the batched result
    var photos = inspectionData.photos || [];
    var obd2_codes = inspectionData.obd2_codes || [];
    var title_images = inspectionData.title_images || [];

    if (photos.length === 0) {
      ctx.error("No photos found for inspection");
      await Database.updateInspectionStatus(inspectionId, "failed");
      return;
    }

    ctx.info("Inspection data retrieved successfully", {
      photos_count: photos.length,
      inspection_type: inspectionData.type,
    });

    // Update status to analyzing
    // ctx.debug("Updating inspection status to analyzing");
    // await Database.updateInspectionStatus(inspectionId, "analyzing");

    // Categorize images using Dify API (only for non-URL inspections)
    if (
      inspectionData.type !== "url" &&
      (photos.length > 0 || obd2_codes.length > 0 || title_images.length > 0)
    ) {
      const totalImages =
        photos.length + obd2_codes.length + title_images.length;
      ctx.info("Starting image categorization", {
        photos_count: photos.length,
        obd2_codes_count: obd2_codes.length,
        title_images_count: title_images.length,
        total_images: totalImages,
      });
      try {
        await categorizeImages(photos, inspectionId, obd2_codes, title_images);
        ctx.info("Image categorization completed successfully");
      } catch (error) {
        ctx.warn("Image categorization failed, continuing with analysis", {
          error: (error as Error).message,
        });
      }
    }

    // Fire-and-forget request to function-call service
    ctx.info("Sending request to function-call service for Dify workflow");
    // We don't await the streaming response since it will run in background
    fetch(`${SUPABASE_CONFIG.url}/functions/v1/function-call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_CONFIG.serviceKey}`,
      },
      body: JSON.stringify({
        function_name: "car_inspection_workflow",
        response_mode: "streaming",
        inspection_id: inspectionId,
      }),
    })
      .then(async (functionCallResponse) => {
        if (!functionCallResponse.ok) {
          const errorText = await functionCallResponse.text();
          ctx.error("Function-call service request failed", {
            status: functionCallResponse.status,
            status_text: functionCallResponse.statusText,
            error_text: errorText,
          });
          return;
        }

        ctx.info(
          "Successfully initiated Dify workflow via function-call service"
        );

        // The streaming response will be handled entirely by the function-call service
        // We don't need to process the stream here since it's fire-and-forget
      })
      .catch((error) => {
        ctx.error("Error sending data to function-call service", {
          error: (error as Error).message,
        });
      });

    ctx.info("Dify workflow request sent to function-call service");
    return;
  } catch (error) {
    ctx.error("Background analysis failed", {
      error: (error as Error).message,
    });
    await Database.updateInspectionStatus(inspectionId, "failed");
  }
}
// Helper that chains scrape → analysis
export async function runScrapeThenAnalysis(
  inspection: Inspection,
  ctx: RequestContext
): Promise<void> {
  try {
    ctx.info("Starting scrape for inspection", {
      inspection_id: inspection.id,
    });

    const scrapeRes = await fetch(`${APP_BASE_URL}/api/scrape-vehicle-images`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: inspection.url,
        upload: true,
        bucket: "inspection-photos",
        inspectionId: inspection.id,
      }),
    });

    if (!scrapeRes.ok) {
      throw new Error(`Scrape failed: ${scrapeRes.statusText}`);
    }

    ctx.info("Scrape succeeded, starting analysis", {
      inspection_id: inspection.id,
    });
    await runAnalysisInBackground(inspection.id, ctx);
  } catch (err) {
    ctx.error("Error in scrape→analysis pipeline", {
      inspection_id: inspection.id,
      error: (err as Error).message,
    });
    // Optionally mark inspection as failed
    await Database.updateInspectionStatus(inspection.id, "failed");
  }
}
