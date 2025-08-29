import { APP_BASE_URL, SUPABASE_CONFIG } from "./config.ts";
import { createDatabaseService } from "../shared/database-service.ts";
import { categorizeImages } from "./categorization.ts";
import { StatusManager } from "./status-manager.ts";
import type { Inspection, ProcessingJob, ChunkImage } from "./schemas.ts";

// Initialize optimized database service
const dbService = createDatabaseService();

// Background analysis function
export async function runAnalysisInBackground(
  inspectionId: string
): Promise<void> {
  try {
    console.log(`Starting background analysis for inspection ${inspectionId}`);

    // Update status to processing
    await dbService.updateInspectionStatus(inspectionId, "processing");

    // Batch fetch all inspection data in a single query
    const { data: inspectionData, error: inspectionError } =
      await dbService.batchFetchInspectionData(inspectionId);

    if (inspectionError || !inspectionData) {
      console.error("Error fetching inspection data:", inspectionError);
      await dbService.updateInspectionStatus(inspectionId, "failed");
      return;
    }

    // Extract data from the batched result
    var photos = inspectionData.photos || [];

    if (photos.length === 0) {
      console.error("No photos found for inspection");
      await dbService.updateInspectionStatus(inspectionId, "failed");
      return;
    }

    // Update status to analyzing
    await dbService.updateInspectionStatus(inspectionId, "analyzing");

    // Categorize images using Dify API (only for non-URL inspections)
    if (inspectionData.type !== "url" && photos.length > 0) {
      console.log(`Starting image categorization for ${photos.length} photos`);
      try {
        await categorizeImages(photos);
        console.log("Image categorization completed successfully");
      } catch (error) {
        console.error("Image categorization failed:", error);
        // Continue with the process even if categorization fails
      }
    }

    // Trigger Dify workflow directly via function-call service
    const triggerResponse = await fetch(
      `${SUPABASE_CONFIG.url}/functions/v1/function-call`,
      {
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
      }
    );

    if (!triggerResponse.ok) {
      console.error("Error triggering Dify workflow via function-call");
      await dbService.updateInspectionStatus(inspectionId, "failed");
      return;
    }

    console.log(
      `Successfully triggered Dify car inspection workflow for inspection ${inspectionId}`
    );
    return;
  } catch (error) {
    console.error(
      `Background analysis failed for inspection ${inspectionId}:`,
      error
    );
    await dbService.updateInspectionStatus(inspectionId, "failed");
  }
}
// Helper that chains scrape → analysis
export async function runScrapeThenAnalysis(
  inspection: Inspection
): Promise<void> {
  try {
    console.log(`Starting scrape for inspection ${inspection.id}`);

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

    console.log(
      `Scrape succeeded for inspection ${inspection.id}, starting analysis`
    );
    await runAnalysisInBackground(inspection.id);
  } catch (err) {
    console.error(`Error in scrape→analysis for ${inspection.id}:`, err);
    // Optionally mark inspection as failed
    await dbService.updateInspectionStatus(inspection.id, "failed");
  }
}
