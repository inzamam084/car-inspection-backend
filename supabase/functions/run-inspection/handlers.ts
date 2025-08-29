import { supabase } from "./config.ts";
import { runAnalysisInBackground, runScrapeThenAnalysis } from "./processor.ts";
import { processExtensionData } from "./extension-handler.ts";
import { runInBackground } from "./background-task.ts";
import {
  createJsonResponse,
  createErrorResponse,
  HTTP_STATUS,
} from "./utils.ts";

// --- Route Handlers ---

/**
 * Handles webhook payloads for existing inspections.
 * @param payload The webhook payload containing the inspection_id.
 * @returns A Response object.
 */
export async function handleWebhookRequest(payload: {
  inspection_id: string;
}): Promise<Response> {
  const { inspection_id: inspectionId } = payload;
  console.log(`Processing analysis for inspection ${inspectionId}`);

  if (!inspectionId) {
    return createErrorResponse(
      "`inspection_id` is required in request payload.",
      HTTP_STATUS.BAD_REQUEST
    );
  }

  const { data: inspection, error } = await supabase
    .from("inspections")
    .select("id, vin, email, type, url")
    .eq("id", inspectionId)
    .single();

  if (error || !inspection) {
    console.error(`Error fetching inspection ${inspectionId}:`, error);
    return createErrorResponse(
      "Failed to fetch inspection details.",
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    );
  }

  // Decide which pipeline to invoke and run in the background
  if (inspection.type === "url") {
    runInBackground(() => runScrapeThenAnalysis(inspection));
  } else {
    runInBackground(() => runAnalysisInBackground(inspection.id));
  }

  return createJsonResponse(
    {
      success: true,
      message: "Analysis started in background",
      inspectionId,
      status: "processing",
    },
    HTTP_STATUS.ACCEPTED
  );
}

/**
 * Handles data submitted from the browser extension.
 * @param payload The extension payload.
 * @returns A Response object.
 */
export function handleExtensionRequest(payload: any): Response {
  console.log("Processing extension vehicle data.");

  // Support both wrapped format (`{ "vehicleData": {...} }`) and direct format (`{ "gallery_images": ... }`)
  const vehicleData = "vehicleData" in payload ? payload.vehicleData : payload;

  // Generate a temporary ID for immediate feedback to the client
  const tempInspectionId = `temp-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 11)}`;

  runInBackground(async () => {
    const result = await processExtensionData(vehicleData);
    if (!result.success) {
      console.error(
        `[background] Extension processing failed for ${tempInspectionId}: ${result.error}`
      );
    }
  });

  return createJsonResponse(
    {
      success: true,
      message: "Extension data processing started in background",
      inspectionId: tempInspectionId,
      status: "processing",
    },
    HTTP_STATUS.ACCEPTED
  );
}

/**
 * Routes the request to the appropriate handler based on payload content.
 * @param payload The parsed request payload.
 * @returns A promise resolving to a Response object.
 */
export function routeRequest(payload: any): Promise<Response> {
  if (typeof payload !== "object" || payload === null) {
    return Promise.resolve(
      createErrorResponse(
        "Invalid payload format. Expected a JSON object.",
        HTTP_STATUS.BAD_REQUEST
      )
    );
  }

  // Route 1: Webhook for existing inspection
  if ("inspection_id" in payload) {
    return handleWebhookRequest(payload);
  }

  // Route 2: Data from browser extension (two possible formats)
  if (
    "vehicleData" in payload ||
    ("gallery_images" in payload &&
      "make" in payload &&
      "model" in payload &&
      "year" in payload)
  ) {
    return Promise.resolve(handleExtensionRequest(payload));
  }

  // Fallback: Invalid format
  return Promise.resolve(
    createErrorResponse(
      "Invalid payload format. Expected `inspection_id` or `vehicleData` fields.",
      HTTP_STATUS.BAD_REQUEST
    )
  );
}
