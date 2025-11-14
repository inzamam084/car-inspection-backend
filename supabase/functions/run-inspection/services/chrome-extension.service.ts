import { supabase } from "../config/supabase.config.ts";
import { logInfo, logDebug } from "../utils/logger.ts";
import type {
  ChromeExtensionPayload,
  N8nAppraisalPayload,
} from "../types/index.ts";
import { uploadChromeExtensionImages } from "./image-upload.service.ts";

/**
 * Create inspection record in database for Chrome Extension request
 */
export async function createInspectionRecord(
  chromePayload: ChromeExtensionPayload,
  userId: string,
  requestId: string
): Promise<{ success: boolean; inspectionId?: string; error?: string }> {
  try {
    // Create inspection record using shared supabase client
    const { data, error } = await supabase
      .from("inspections")
      .insert({
        user_id: userId,
        vin: chromePayload.vin || null,
        mileage: chromePayload.mileage || null,
        email: chromePayload.email || null,
        status: "processing",
        type: "extension", // Mark as coming from extension
      })
      .select("id")
      .single();

    if (error) {
      logInfo(requestId, "Failed to create inspection record", {
        error: error.message,
      });
      return { success: false, error: error.message };
    }

    logInfo(requestId, "Created inspection record", {
      inspection_id: data.id,
    });

    return { success: true, inspectionId: data.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Process Chrome Extension request: Create inspection, upload images, prepare n8n payload
 */
export async function processChromeExtensionRequest(
  chromePayload: ChromeExtensionPayload,
  userId: string,
  requestId: string
): Promise<{
  success: boolean;
  n8nPayload?: N8nAppraisalPayload;
  appraisalId?: string;
  error?: string;
}> {
  try {
    // 1. Create inspection record
    logInfo(requestId, "Processing Chrome Extension request", {
      vehicle: getVehicleSummary(chromePayload),
      image_count: chromePayload.gallery_images.length,
    });

    const inspectionResult = await createInspectionRecord(
      chromePayload,
      userId,
      requestId
    );

    if (!inspectionResult.success || !inspectionResult.inspectionId) {
      return {
        success: false,
        error: inspectionResult.error || "Failed to create inspection",
      };
    }

    const inspectionId = inspectionResult.inspectionId;

    // 2. Upload images to Supabase storage
    logInfo(requestId, "Uploading images from external URLs to Supabase", {
      inspection_id: inspectionId,
      image_count: chromePayload.gallery_images.length,
    });

    const uploadResult = await uploadChromeExtensionImages(
      chromePayload.gallery_images,
      inspectionId,
      requestId
    );

    if (
      !uploadResult.success ||
      !uploadResult.urls ||
      uploadResult.urls.length < 3
    ) {
      return {
        success: false,
        error: `Failed to upload sufficient images. Got ${
          uploadResult.urls?.length || 0
        }/3 minimum. ${uploadResult.errors?.join(", ")}`,
      };
    }

    // Log any partial failures
    if (uploadResult.errors && uploadResult.errors.length > 0) {
      logInfo(
        requestId,
        "Some images failed to upload (continuing with successful ones)",
        {
          failed_count: uploadResult.errors.length,
        }
      );
    }

    // 3. Build n8n payload with Supabase URLs
    const n8nPayload = buildN8nPayload(
      chromePayload,
      uploadResult.urls,
      inspectionId,
      requestId
    );

    logInfo(requestId, "Chrome Extension request processed successfully", {
      inspection_id: inspectionId,
      supabase_image_count: uploadResult.urls.length,
    });

    return {
      success: true,
      n8nPayload,
      appraisalId: inspectionId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * Build N8n payload from Chrome Extension data
 */
function buildN8nPayload(
  chromePayload: ChromeExtensionPayload,
  supabaseImageUrls: string[],
  inspectionId: string,
  requestId: string
): N8nAppraisalPayload {
  logDebug(requestId, "Building N8n payload");

  // Extract notes from description and other fields
  const notes: string[] = [];

  // if (chromePayload.description) {
  //   notes.push(`Description: ${chromePayload.description}`);
  // }

  // if (chromePayload.seller_name) {
  //   notes.push(`Seller: ${chromePayload.seller_name}`);
  // }

  // if (chromePayload.seller_phone) {
  //   notes.push(`Contact: ${chromePayload.seller_phone}`);
  // }

  // if (chromePayload.listing_url) {
  //   notes.push(`Listing URL: ${chromePayload.listing_url}`);
  // }

  // if (chromePayload.price) {
  //   notes.push(`Listed Price: ${chromePayload.price}`);
  // }

  // if (chromePayload.platform) {
  //   notes.push(`Platform: ${chromePayload.platform}`);
  // }

  // Build the n8n payload
  const n8nPayload: N8nAppraisalPayload = {
    vin: chromePayload.vin || "", // Empty string if no VIN (n8n will extract from photos)
    mileage: chromePayload.mileage || undefined,
    obdii_codes: undefined, // Chrome extension doesn't capture OBD2 codes
    notes: notes.length > 0 ? notes.join("\n\n") : undefined,
    image_urls: supabaseImageUrls, // Use Supabase URLs, not external URLs!
    appraisal_id: inspectionId,
    image_count: supabaseImageUrls.length,
  };

  return n8nPayload;
}

/**
 * Extract vehicle summary for logging
 */
export function getVehicleSummary(payload: ChromeExtensionPayload): string {
  const parts: string[] = [];

  if (payload.year) parts.push(payload.year.toString());
  if (payload.make) parts.push(payload.make);
  if (payload.model) parts.push(payload.model);

  if (parts.length > 0) {
    return parts.join(" ");
  }

  return payload.vin || "Unknown vehicle";
}
