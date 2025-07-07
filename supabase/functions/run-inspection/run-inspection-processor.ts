import { APP_BASE_URL, SUPABASE_CONFIG } from "./config.ts";
import { createDatabaseService } from "../shared/database-service.ts";
import type { Inspection, ProcessingJob, ChunkImage } from "./schemas.ts";

// Initialize optimized database service
const dbService = createDatabaseService();

// Background analysis function
export async function runAnalysisInBackground(
  inspectionId: string,
): Promise<void> {
  try {
    console.log(`Starting background analysis for inspection ${inspectionId}`);

    // Update status to processing
    await dbService.updateInspectionStatus(inspectionId, "processing");

    // Batch fetch all inspection data in a single query
    const { data: inspectionData, error: inspectionError } = await dbService
      .batchFetchInspectionData(inspectionId);

    if (inspectionError || !inspectionData) {
      console.error("Error fetching inspection data:", inspectionError);
      await dbService.updateInspectionStatus(inspectionId, "failed");
      return;
    }

    // Extract data from the batched result
    const photos = inspectionData.photos || [];
    const obd2_codes = inspectionData.obd2_codes || [];
    const titleImages = inspectionData.title_images || [];

    if (photos.length === 0) {
      console.error("No photos found for inspection");
      await dbService.updateInspectionStatus(inspectionId, "failed");
      return;
    }

    // Update status to analyzing
    await dbService.updateInspectionStatus(inspectionId, "analyzing");

    // Calculate total image size for logging
    const photosSize = photos.reduce(
      (sum, photo) => sum + (parseInt(photo.storage) || 0),
      0,
    );
    const obd2ImagesSize = obd2_codes.reduce(
      (sum, obd) => sum + (parseInt(obd.storage) || 0),
      0,
    );
    const titleImagesSize = titleImages.reduce(
      (sum, img) => sum + (parseInt(img.storage) || 0),
      0,
    );
    const totalImageSize = photosSize + obd2ImagesSize + titleImagesSize;

    console.log(
      `Total image size: ${(totalImageSize / (1024 * 1024)).toFixed(2)} MB`,
    );

    // Use simplified queue-based processing with single analysis job
    console.log("Processing inspection using simplified queue-based system");

    // Update status to creating_jobs
    await dbService.updateInspectionStatus(inspectionId, "creating_jobs");

    // Create processing jobs - single analysis job followed by other jobs
    const jobs: ProcessingJob[] = [];

    // Transform all images to ChunkImage format
    const allImages: ChunkImage[] = [
      // Transform photos
      ...photos.map(photo => ({
        id: photo.id,
        path: photo.converted_path || photo.path,
        category: photo.category,
        storage: parseInt(photo.storage) || 0,
        type: 'photo' as const,
      })),
      // Transform OBD2 codes with images
      ...obd2_codes.filter(obd => obd.screenshot_path).map(obd => ({
        id: obd.id,
        path: obd.converted_path || obd.screenshot_path!,
        category: 'obd',
        storage: parseInt(obd.storage) || 0,
        type: 'obd2_image' as const,
        code: obd.code,
        description: obd.description,
      })),
      // Transform title images
      ...titleImages.map(title => ({
        id: title.id,
        path: title.converted_path || title.path,
        category: 'title',
        storage: parseInt(title.storage) || 0,
        type: 'title_image' as const,
      })),
    ];

    // Single analysis job that processes all images
    jobs.push({
      inspection_id: inspectionId,
      job_type: "chunk_analysis",
      sequence_order: 1,
      chunk_index: 1,
      total_chunks: 1,
      chunk_data: {
        images: allImages,
      },
      status: "pending",
    });

    // Add ownership cost forecast, fair market value and expert advice jobs after analysis
    jobs.push({
      inspection_id: inspectionId,
      job_type: "ownership_cost_forecast",
      sequence_order: 2,
      chunk_index: 1,
      total_chunks: 1,
      chunk_data: {},
      status: "pending",
    });

    jobs.push({
      inspection_id: inspectionId,
      job_type: "fair_market_value",
      sequence_order: 3,
      chunk_index: 1,
      total_chunks: 1,
      chunk_data: {},
      status: "pending",
    });

    jobs.push({
      inspection_id: inspectionId,
      job_type: "expert_advice",
      sequence_order: 4,
      chunk_index: 1,
      total_chunks: 1,
      chunk_data: {},
      status: "pending",
    });

    // Insert all jobs into the queue using batch operation
    const { error: jobsError } = await dbService.batchCreateProcessingJobs(
      jobs,
    );

    if (jobsError) {
      console.error("Error creating processing jobs:", jobsError);
      await dbService.updateInspectionStatus(inspectionId, "failed");
      return;
    }

    console.log(
      `Created ${jobs.length} processing jobs for inspection ${inspectionId}`,
    );

    // Trigger the first chunk processing
    const triggerResponse = await fetch(
      `${SUPABASE_CONFIG.url}/functions/v1/process-next-chunk`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_CONFIG.serviceKey}`,
        },
        body: JSON.stringify({
          inspection_id: inspectionId,
          completed_sequence: 0,
        }),
      },
    );

    if (!triggerResponse.ok) {
      console.error("Error triggering first chunk processing");
      await dbService.updateInspectionStatus(inspectionId, "failed");
      return;
    }

    console.log(
      `Successfully triggered queue-based processing for inspection ${inspectionId}`,
    );
    return;
  } catch (error) {
    console.error(
      `Background analysis failed for inspection ${inspectionId}:`,
      error,
    );
    await dbService.updateInspectionStatus(inspectionId, "failed");
  }
}

// Helper that chains scrape → analysis
export async function runScrapeThenAnalysis(
  inspection: Inspection,
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
      `Scrape succeeded for inspection ${inspection.id}, starting analysis`,
    );
    await runAnalysisInBackground(inspection.id);
  } catch (err) {
    console.error(`Error in scrape→analysis for ${inspection.id}:`, err);
    // Optionally mark inspection as failed
    await dbService.updateInspectionStatus(inspection.id, "failed");
  }
}
