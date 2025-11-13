import { HTTP_STATUS, logInfo } from "../utils/logger.ts";
import { LIMITS } from "../config/constants.ts";
import {
  validateWebsitePayload,
  validateChromeExtensionPayload,
} from "../utils/request-validator.ts";
import {
  fetchInspectionData,
  buildImageUrls,
  formatObd2Codes,
} from "./inspection.service.ts";
import { processChromeExtensionRequest } from "./chrome-extension.service.ts";
import type {
  WebsitePayload,
  ChromeExtensionPayload,
  N8nAppraisalPayload,
  InspectionData,
} from "../types/index.ts";

interface RequestHandlerResult {
  success: boolean;
  n8nPayload?: N8nAppraisalPayload;
  appraisalId?: string;
  error?: string;
  details?: string[];
  statusCode?: number;
}

/**
 * Handle website request: Fetch inspection from DB and build n8n payload
 */
export async function handleWebsiteRequest(
  payload: unknown,
  requestId: string
): Promise<RequestHandlerResult> {
  const websitePayload = payload as WebsitePayload;

  // Validate payload
  const validation = validateWebsitePayload(websitePayload, requestId);
  if (!validation.valid) {
    return {
      success: false,
      error: "Invalid website payload",
      details: validation.errors,
      statusCode: HTTP_STATUS.BAD_REQUEST,
    };
  }

  const { inspection_id } = websitePayload;

  // Fetch inspection data
  logInfo(requestId, "Fetching inspection data from database", {
    inspection_id,
  });

  const { data: inspectionData, error: fetchError } =
    await fetchInspectionData(inspection_id, requestId);

  if (fetchError || !inspectionData) {
    return {
      success: false,
      error: fetchError || "Inspection not found",
      statusCode: HTTP_STATUS.NOT_FOUND,
    };
  }

  // Validate inspection data
  const dataValidation = validateInspectionData(inspectionData);
  if (!dataValidation.valid) {
    return {
      success: false,
      error: dataValidation.error!,
      statusCode: HTTP_STATUS.BAD_REQUEST,
    };
  }

  // Build n8n payload
  const imageUrls = buildImageUrls(inspectionData.photos);
  const n8nPayload: N8nAppraisalPayload = {
    vin: inspectionData.vin!,
    mileage: inspectionData.mileage || undefined,
    obdii_codes: formatObd2Codes(inspectionData.obd2_codes) || undefined,
    notes: undefined,
    image_urls: imageUrls,
    appraisal_id: inspection_id,
    image_count: imageUrls.length,
  };

  logInfo(requestId, "Website request processed", {
    inspection_id,
    vin: n8nPayload.vin,
    image_count: n8nPayload.image_count,
  });

  return {
    success: true,
    n8nPayload,
    appraisalId: inspection_id,
  };
}

/**
 * Handle Chrome Extension request: Create inspection, upload images, build payload
 */
export async function handleChromeExtensionRequest(
  payload: unknown,
  userId: string,
  requestId: string
): Promise<RequestHandlerResult> {
  const chromePayload = payload as ChromeExtensionPayload;

  // Validate payload
  const validation = validateChromeExtensionPayload(chromePayload, requestId);
  if (!validation.valid) {
    return {
      success: false,
      error: "Invalid chrome extension payload",
      details: validation.errors,
      statusCode: HTTP_STATUS.BAD_REQUEST,
    };
  }

  // Process Chrome Extension request
  logInfo(requestId, "Processing Chrome Extension request");

  const processResult = await processChromeExtensionRequest(
    chromePayload,
    userId,
    requestId
  );

  if (!processResult.success || !processResult.n8nPayload || !processResult.appraisalId) {
    return {
      success: false,
      error: processResult.error || "Failed to process Chrome Extension request",
      statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    };
  }

  logInfo(requestId, "Chrome Extension request processed", {
    inspection_id: processResult.appraisalId,
    image_count: processResult.n8nPayload.image_count,
  });

  return {
    success: true,
    n8nPayload: processResult.n8nPayload,
    appraisalId: processResult.appraisalId,
  };
}

/**
 * Validate that inspection has required data for appraisal
 */
function validateInspectionData(
  data: InspectionData
): { valid: boolean; error?: string } {
  if (!data.vin) {
    return { valid: false, error: "Inspection does not have VIN" };
  }

  if (!data.photos || data.photos.length === 0) {
    return { valid: false, error: "Inspection has no photos" };
  }

  if (data.photos.length < LIMITS.MIN_IMAGES_REQUIRED) {
    return {
      valid: false,
      error: `Inspection must have at least ${LIMITS.MIN_IMAGES_REQUIRED} photos (has ${data.photos.length})`,
    };
  }

  return { valid: true };
}

