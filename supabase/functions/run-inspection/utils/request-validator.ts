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
    !payload.gallery_images &&
    !payload.listing_url
  ) {
    return "website";
  }

  // Chrome extension has gallery_images, listing_url, year, make, model
  if (
    payload.gallery_images &&
    Array.isArray(payload.gallery_images) &&
    (payload.listing_url || payload.year || payload.make)
  ) {
    return "chrome_extension";
  }

  // Fallback: Check for type field
  if (payload.type === "extension") {
    return "chrome_extension";
  }

  // Default to website for backwards compatibility
  return "website";
}

/**
 * Validate Chrome Extension payload
 */
export function validateChromeExtensionPayload(
  payload: any,
  requestId: string
): ValidationResult {
  const errors: string[] = [];

  // Check for gallery_images
  if (!payload.gallery_images || !Array.isArray(payload.gallery_images)) {
    errors.push("gallery_images is required and must be an array");
  } else if (payload.gallery_images.length === 0) {
    errors.push("gallery_images must contain at least one image");
  } else if (payload.gallery_images.length < 3) {
    errors.push("Minimum 3 images required for appraisal");
  }

  // VIN is optional for chrome extension, but log if missing
  if (!payload.vin) {
    logDebug(requestId, "Chrome extension payload missing VIN (will attempt to extract from images)");
  }

  // Check for vehicle data (at least some identification)
  if (!payload.year && !payload.make && !payload.model && !payload.vin) {
    errors.push("Vehicle identification required: at least one of (year, make, model, vin)");
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
