/**
 * Request source types
 */
export type RequestSource = "chrome_extension" | "website";

/**
 * Chrome Extension request payload
 */
export interface ChromeExtensionPayload {
  vin: string;
  mileage?: string;
  obdii_codes?: string;
  notes?: string;
  image_urls: string[];
  appraisal_id: string;
  image_count: number;
}

/**
 * Website request payload
 */
export interface WebsitePayload {
  inspection_id: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

