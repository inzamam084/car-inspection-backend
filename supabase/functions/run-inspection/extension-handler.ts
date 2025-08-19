import { supabase } from "./config.ts";
import { ImageProcessor } from "./image-processor.ts";
import { runAnalysisInBackground } from "./processor.ts";
import { StatusManager } from "./status-manager.ts";
import { runInBackground } from "./background-task.ts";
import type { ExtensionVehicleData } from "./schemas.ts";

export async function processExtensionData(vehicleData: ExtensionVehicleData): Promise<{
  success: boolean;
  inspectionId?: string;
  error?: string;
}> {
  try {
    console.log(`🚗 Processing extension data for ${vehicleData.make} ${vehicleData.model} ${vehicleData.year}`);
    console.log(`📸 Found ${vehicleData.gallery_images.length} images to process`);

    // Create inspection record
    const inspectionResult = await createInspectionFromVehicleData(vehicleData);
    if (!inspectionResult.success || !inspectionResult.inspectionId) {
      return {
        success: false,
        error: inspectionResult.error || "Failed to create inspection"
      };
    }

    const inspectionId = inspectionResult.inspectionId;
    console.log(`✅ Created inspection with ID: ${inspectionId}`);

    // Update status to processing using centralized manager
    await StatusManager.updateStatus(inspectionId, "processing");

    // Process images using ImageProcessor
    const imageProcessor = new ImageProcessor();
    const lotId = vehicleData.vin || `lot-${Date.now()}`;
    
    console.log(`🖼️ Starting image processing for lot: ${lotId}`);
    const uploadResults = await imageProcessor.processImages(
      vehicleData.gallery_images,
      lotId,
      inspectionId,
      "inspection-photos"
    );

    const successfulUploads = uploadResults.filter(r => r.success).length;
    const failedUploads = uploadResults.filter(r => !r.success).length;

    console.log(`📊 Image processing completed: ${successfulUploads} successful, ${failedUploads} failed`);

    if (successfulUploads === 0) {
      // Update status to failed if no images were processed
      await StatusManager.markAsFailed(inspectionId, "No images were successfully processed");
      return {
        success: false,
        error: "No images were successfully processed"
      };
    }

    // Start the analysis pipeline in background
    console.log(`🔄 Starting analysis pipeline for inspection ${inspectionId}`);
    
    runInBackground(async () => {
      try {
        await runAnalysisInBackground(inspectionId);
      } catch (error) {
        console.error(`Background analysis failed for inspection ${inspectionId}:`, error);
        await StatusManager.markAsFailed(inspectionId, `Analysis failed: ${(error as Error).message}`);
      }
    });

    return {
      success: true,
      inspectionId: inspectionId
    };

  } catch (error) {
    console.error("Error processing extension data:", error);
    return {
      success: false,
      error: (error as Error).message
    };
  }
}

async function createInspectionFromVehicleData(vehicleData: ExtensionVehicleData): Promise<{
  success: boolean;
  inspectionId?: string;
  error?: string;
}> {
  try {
    // Extract relevant data for inspection
    const inspectionData = {
      email: vehicleData.email || "extension@copart.com", // Default email if not provided
      user_id: vehicleData.user_id || null, // Optional user ID
      vin: vehicleData.vin,
      mileage: vehicleData.mileage,
      status: "pending",
      type: "extension", // Mark as extension-sourced
      url: vehicleData.listing_url,
      created_at: new Date().toISOString()
    };

    console.log("Creating inspection with data:", inspectionData);

    const { data, error } = await supabase
      .from("inspections")
      .insert(inspectionData)
      .select("id")
      .single();

    if (error) {
      console.error("Error creating inspection:", error);
      return {
        success: false,
        error: error.message
      };
    }

    if (!data?.id) {
      return {
        success: false,
        error: "No inspection ID returned"
      };
    }

    // Store additional vehicle metadata in a separate table or as JSON
    // For now, we'll log it for reference
    console.log("Additional vehicle metadata:", {
      make: vehicleData.make,
      model: vehicleData.model,
      year: vehicleData.year,
      price: vehicleData.price,
      seller_name: vehicleData.seller_name,
      seller_phone: vehicleData.seller_phone,
      description: vehicleData.description,
      scraped_at: vehicleData.scraped_at
    });

    return {
      success: true,
      inspectionId: data.id
    };

  } catch (error) {
    console.error("Unexpected error creating inspection:", error);
    return {
      success: false,
      error: (error as Error).message
    };
  }
}
