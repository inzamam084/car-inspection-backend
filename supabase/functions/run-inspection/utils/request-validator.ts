import { logDebug, logError } from "./logger.ts";
import type {
  RequestSource,
  ValidationResult,
} from "../types/index.ts";

/**
 * Detect request source based on payload structure
 */
export function detectRequestSource(payload: any): RequestSource {
  // Website payload only has inspection_id
  if (
    payload.inspection_id &&
    !payload.vin &&
    !payload.image_urls &&
    !payload.appraisal_id
  ) {
    return "website";
  }

  // Chrome extension has vin, image_urls, appraisal_id
  if (payload.vin && payload.image_urls && payload.appraisal_id) {
    return "chrome_extension";
  }

  // Default to chrome extension for backwards compatibility
  return "chrome_extension";
}

/**
 * Validate Chrome Extension payload
 */
export function validateChromeExtensionPayload(
  payload: any,
  requestId: string
): ValidationResult {
  const errors: string[] = [];

  if (!payload.vin || typeof payload.vin !== "string") {
    errors.push("vin is required and must be a string");
  }

  if (!payload.image_urls || !Array.isArray(payload.image_urls)) {
    errors.push("image_urls is required and must be an array");
  } else if (payload.image_urls.length === 0) {
    errors.push("image_urls must contain at least one image");
  } else if (payload.image_urls.length < 3) {
    errors.push("Minimum 3 images required for appraisal");
  }

  if (!payload.appraisal_id || typeof payload.appraisal_id !== "string") {
    errors.push("appraisal_id is required and must be a string");
  }

  if (errors.length > 0) {
    logError(requestId, "Chrome Extension payload validation failed", {
      errors,
    });
  } else {
    logDebug(requestId, "Chrome Extension payload validated successfully");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate Website payload
 */
export function validateWebsitePayload(
  payload: any,
  requestId: string
): ValidationResult {
  const errors: string[] = [];

  if (!payload.inspection_id || typeof payload.inspection_id !== "string") {
    errors.push("inspection_id is required and must be a string");
  }

  if (errors.length > 0) {
    logError(requestId, "Website payload validation failed", {
      errors,
    });
  } else {
    logDebug(requestId, "Website payload validated successfully");
  }

  return { valid: errors.length === 0, errors };
}
