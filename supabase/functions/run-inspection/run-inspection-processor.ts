import { supabase, APP_BASE_URL, MAX_CHUNK_SIZE, SUPABASE_CONFIG } from "./config.ts";
import { createCategoryBasedChunks } from "./utils.ts";
import type { 
  Inspection, 
  Photo, 
  OBD2Code, 
  TitleImage, 
  ProcessingJob, 
  DataBlock 
} from "./schemas.ts";

// Background analysis function
export async function runAnalysisInBackground(inspectionId: string): Promise<void> {
  try {
    console.log(`Starting background analysis for inspection ${inspectionId}`);
    
    // Update status to processing
    await supabase
      .from("inspections")
      .update({ status: "processing" })
      .eq("id", inspectionId);

    // Fetch inspection details
    const { data: inspection, error: inspectionError } = await supabase
      .from("inspections")
      .select("id, vin, email, mileage, zip")
      .eq("id", inspectionId)
      .single();

    if (inspectionError) {
      console.error("Error fetching inspection:", inspectionError);
      await supabase
        .from("inspections")
        .update({ status: "failed" })
        .eq("id", inspectionId);
      return;
    }

    // Update status to analyzing
    await supabase
      .from("inspections")
      .update({ status: "analyzing" })
      .eq("id", inspectionId);

    // Fetch all photos for this inspection with storage info
    const { data: photos, error: photosError } = await supabase
      .from("photos")
      .select("id, category, path, storage")
      .eq("inspection_id", inspectionId);

    if (photosError || !photos || photos.length === 0) {
      console.error("Error fetching photos:", photosError);
      await supabase
        .from("inspections")
        .update({ status: "failed" })
        .eq("id", inspectionId);
      return;
    }

    // Fetch OBD2 codes
    const { data: obd2_codes, error: obd2Error } = await supabase
      .from("obd2_codes")
      .select("id, code, description, screenshot_path, storage")
      .eq("inspection_id", inspectionId);

    if (obd2Error) {
      console.error("Error fetching OBD2 Codes:", obd2Error);
      await supabase
        .from("inspections")
        .update({ status: "failed" })
        .eq("id", inspectionId);
      return;
    }

    // Fetch title images
    const { data: titleImages, error: titleImageError } = await supabase
      .from("title_images")
      .select("id, path, storage")
      .eq("inspection_id", inspectionId);

    if (titleImageError) {
      console.error("Error fetching Title Images:", titleImageError);
      await supabase
        .from("inspections")
        .update({ status: "failed" })
        .eq("id", inspectionId);
      return;
    }

    // Create data block for the master prompt
    const dataBlock: DataBlock = {
      vin: inspection.vin,
      mileage: inspection?.mileage || null,
      zip: inspection?.zip || null,
      vinHistory: null,
      marketPriceBands: null
    };

    // Check if images need chunking based on total size
    const photosSize = photos.reduce((sum, photo) => sum + (parseInt(photo.storage) || 0), 0);
    const obd2ImagesSize = obd2_codes.reduce((sum, obd) => sum + (parseInt(obd.storage) || 0), 0);
    const titleImagesSize = titleImages.reduce((sum, img) => sum + (parseInt(img.storage) || 0), 0);
    const totalImageSize = photosSize + obd2ImagesSize + titleImagesSize;

    console.log(`Total image size: ${(totalImageSize / (1024 * 1024)).toFixed(2)} MB`);

    // Use queue-based processing for large inspections
    console.log("Processing inspection using queue-based system");

    // Update status to creating_jobs
    await supabase
      .from("inspections")
      .update({ status: "creating_jobs" })
      .eq("id", inspectionId);

    // Create chunks
    const chunks = await createCategoryBasedChunks(
      photos, 
      obd2_codes, 
      titleImages, 
      MAX_CHUNK_SIZE, 
      inspectionId
    );

    console.log(`Created ${chunks.length} chunks for queue processing`);

    // Create processing jobs for each chunk
    const jobs: ProcessingJob[] = [];
    
    for (let i = 0; i < chunks.length; i++) {
      jobs.push({
        inspection_id: inspectionId,
        job_type: 'chunk_analysis',
        sequence_order: i + 1,
        chunk_index: i + 1,
        total_chunks: chunks.length,
        chunk_data: {
          images: chunks[i].images
        },
        status: 'pending'
      });
    }

    // Add ownership cost forecast, fair market value and expert advice jobs after chunk analysis
    const nextSequence = chunks.length + 1;
    
    jobs.push({
      inspection_id: inspectionId,
      job_type: 'ownership_cost_forecast',
      sequence_order: nextSequence,
      chunk_index: 1,
      total_chunks: 1,
      chunk_data: {},
      status: 'pending'
    });

    jobs.push({
      inspection_id: inspectionId,
      job_type: 'fair_market_value',
      sequence_order: nextSequence + 1,
      chunk_index: 1,
      total_chunks: 1,
      chunk_data: {},
      status: 'pending'
    });

    jobs.push({
      inspection_id: inspectionId,
      job_type: 'expert_advice',
      sequence_order: nextSequence + 2,
      chunk_index: 1,
      total_chunks: 1,
      chunk_data: {},
      status: 'pending'
    });

    // Insert all jobs into the queue
    const { error: jobsError } = await supabase
      .from('processing_jobs')
      .insert(jobs);

    if (jobsError) {
      console.error('Error creating processing jobs:', jobsError);
      await supabase
        .from("inspections")
        .update({ status: "failed" })
        .eq("id", inspectionId);
      return;
    }

    console.log(`Created ${jobs.length} processing jobs for inspection ${inspectionId}`);

    // Trigger the first chunk processing
    const triggerResponse = await fetch(`${SUPABASE_CONFIG.url}/functions/v1/process-next-chunk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_CONFIG.serviceKey}`
      },
      body: JSON.stringify({
        inspection_id: inspectionId,
        completed_sequence: 0
      })
    });

    if (!triggerResponse.ok) {
      console.error('Error triggering first chunk processing');
      await supabase
        .from("inspections")
        .update({ status: "failed" })
        .eq("id", inspectionId);
      return;
    }

    console.log(`Successfully triggered queue-based processing for inspection ${inspectionId}`);
    return;

  } catch (error) {
    console.error(`Background analysis failed for inspection ${inspectionId}:`, error);
    await supabase
      .from("inspections")
      .update({ status: "failed" })
      .eq("id", inspectionId);
  }
}

// Helper that chains scrape → analysis
export async function runScrapeThenAnalysis(inspection: Inspection): Promise<void> {
  try {
    console.log(`Starting scrape for inspection ${inspection.id}`);
    
    const scrapeRes = await fetch(`${APP_BASE_URL}/api/scrape-copart-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: inspection.url,
        upload: true,
        bucket: 'inspection-photos',
        inspectionId: inspection.id
      })
    });

    if (!scrapeRes.ok) {
      throw new Error(`Scrape failed: ${scrapeRes.statusText}`);
    }

    console.log(`Scrape succeeded for inspection ${inspection.id}, starting analysis`);
    await runAnalysisInBackground(inspection.id);

  } catch (err) {
    console.error(`Error in scrape→analysis for ${inspection.id}:`, err);
    // Optionally mark inspection as failed
    await supabase
      .from('inspections')
      .update({ status: 'failed' })
      .eq('id', inspection.id);
  }
}
