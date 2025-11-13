import { createDatabaseService } from "../../shared/database-service.ts";
import { logInfo, logError, logDebug } from "../utils/logger.ts";
import type { InspectionData } from "../types/index.ts";

/**
 * Fetch inspection data from Supabase database
 */
export async function fetchInspectionData(
  inspectionId: string,
  requestId: string
): Promise<{ data: InspectionData | null; error: string | null }> {
  try {
    logDebug(requestId, "Fetching inspection data from database", {
      inspection_id: inspectionId,
    });

    const dbService = createDatabaseService();
    const { data, error } = await dbService.batchFetchInspectionData(inspectionId);

    if (error) {
      logError(requestId, "Database error fetching inspection", {
        inspection_id: inspectionId,
        error: error.message,
      });
      return { data: null, error: error.message };
    }

    if (!data) {
      logError(requestId, "Inspection not found", {
        inspection_id: inspectionId,
      });
      return { data: null, error: "Inspection not found" };
    }

    logInfo(requestId, "Inspection data fetched successfully", {
      inspection_id: inspectionId,
      photo_count: data.photos?.length || 0,
      has_vin: !!data.vin,
    });

    return { data: data as InspectionData, error: null };
  } catch (error) {
    const { message, stack } = error as Error;
    logError(requestId, "Failed to fetch inspection data", {
      inspection_id: inspectionId,
      error: message,
      stack,
    });
    return { data: null, error: message };
  }
}

/**
 * Build image URLs from photos
 * Returns array of public URLs from Supabase storage
 */
export function buildImageUrls(
  photos: InspectionData["photos"],
  bucketName: string = "inspection-images"
): string[] {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL environment variable not set");
  }

  return photos
    .filter((photo) => photo.path)
    .map((photo) => {
      // Build public URL for Supabase storage
      return `${supabaseUrl}/storage/v1/object/public/${bucketName}/${photo.path}`;
    });
}

/**
 * Format OBD2 codes as string
 */
export function formatObd2Codes(
  obd2Codes: InspectionData["obd2_codes"]
): string {
  if (!obd2Codes || obd2Codes.length === 0) {
    return "";
  }

  return obd2Codes
    .map((code) => {
      if (code.description) {
        return `${code.code}: ${code.description}`;
      }
      return code.code || "";
    })
    .filter((code) => code.length > 0)
    .join("\n");
}
