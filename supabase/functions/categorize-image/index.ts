/**
 * CATEGORIZE_IMAGE – Supabase Edge Function (Deno)
 * -------------------------------------------------
 *
 * This Edge Function categorizes uploaded vehicle-related images (general photos, OBD-II snapshots,
 * or title/registration images) by sending them to an LLM-backed function-call service for analysis,
 * extracting structured vehicle metadata when available, and persisting both the category and the
 * analysis back to Supabase tables. It also performs intelligent merging of newly extracted vehicle
 * details with any previously stored inspection-level details.
 *
 * ## Responsibilities
 * 1. Validate request payload and handle CORS preflight.
 * 2. Call the `function-call` Edge Function with the image as a remote URL to obtain a structured JSON analysis.
 * 3. Extract canonical vehicle attributes (VIN, Year, Make, Model, etc.) when marked as `available`.
 * 4. Merge extracted attributes into `inspections.vehicle_details` and update direct columns (e.g., `vin`, `mileage`) when appropriate.
 * 5. Update the appropriate table for the underlying resource (`photos`, `obd2_codes`, or `title_images`) with the category and LLM analysis.
 * 6. Apply protective rules when the inspection is an `extension` or `detail` type, so as not to overwrite
 *    higher-quality data (e.g., do not overwrite a meaningful VIN with a lower-quality one).
 * 7. Fallback mechanism: If `image_details_extraction` fails, automatically retry with `image_details_extraction_v2` which uses a different model.
 *
 * ## Retry Logic
 * - Automatic retry with exponential backoff on function-call failures
 * - Up to 3 retries (4 total attempts)
 * - Backoff delays: 1s, 2s, 4s
 * - Only retries on temporary errors (5xx, timeouts, network issues)
 * - Does not retry on permanent errors (4xx, missing data)
 * - Function fallback: Attempts with primary function first, then falls back to v2 if all retries fail
 *
 * ## Tables
 * - `inspections`
 *   - Columns referenced: `id`, `vehicle_details` (JSON), `vin`, `mileage`, `type`
 * - `photos`
 *   - Columns updated: `category`, `llm_analysis`
 * - `obd2_codes`
 *   - Columns updated: `llm_analysis`
 * - `title_images`
 *   - Columns updated: `llm_analysis`
 *
 * ## Environment Variables
 * - `SUPABASE_URL`: Your Supabase project URL.
 * - `SUPABASE_SERVICE_ROLE_KEY`: Service role key used for privileged server-side operations.
 *
 * ## Endpoints Invoked
 * - `POST {SUPABASE_URL}/functions/v1/function-call`
 *   - Body: `{ function_name, query, inspection_id, user_id, files: [ { type: "image", transfer_method: "remote_url", url } ] }`
 *   - Response: `{ success: boolean, payload: string }` where `payload` should parse into a JSON object
 *     of type {@link AnalysisResult}, optionally wrapped in Markdown code fences.
 *
 * ## Request (this function)
 * - Method: `POST`
 * - Body: `{ image_url: string, image_id: string, image_type?: "photo"|"obd2"|"title", inspection_id: string, user_id?: string, inspection_type?: string }`
 *
 * ## Response (this function)
 * - `200 OK` `{ success: true, image_id, category, confidence, reasoning, has_vehicle_data, duration_ms, attempts, function_used }`
 * - `400 Bad Request` when required fields are missing.
 * - `500 Internal Server Error` on any unhandled failure.
 *
 * ## Error & Logging
 * All operations are instrumented with structured logs including timestamps and a static log tag.
 * This helps tracing request flow and diagnosing issues in the Edge function runtime logs.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Default CORS headers for browser access. */
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Constant tag applied to all log lines for easy filtering. */
const LOG_TAG: string = "CATEGORIZE_IMAGE";

/** Retry configuration */
interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

const RETRY_CONFIG: RetryConfig = {
  maxRetries: 3, // Total of 4 attempts (initial + 3 retries)
  baseDelayMs: 1000, // Start with 1 second
  maxDelayMs: 10000, // Cap at 10 seconds
  backoffMultiplier: 2, // Exponential backoff: 1s, 2s, 4s, 8s...
};

/**
 * Emit an informational log line.
 * @param message Human-readable message describing the event.
 * @param data Optional structured context to aid debugging.
 */
function logInfo(message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  console.log(`[${LOG_TAG}] [${timestamp}] INFO: ${message}`, data || "");
}

/**
 * Emit a warning log line.
 * @param message Human-readable message describing the warning.
 * @param data Optional structured context to aid debugging.
 */
function logWarn(message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  console.warn(`[${LOG_TAG}] [${timestamp}] WARN: ${message}`, data || "");
}

/**
 * Emit an error log line.
 * @param message Human-readable message describing the error.
 * @param error Optional error object (or additional context).
 */
function logError(message: string, error?: unknown): void {
  const timestamp = new Date().toISOString();
  console.error(`[${LOG_TAG}] [${timestamp}] ERROR: ${message}`, error || "");
}

/**
 * Emit a debug log line.
 * @param message Human-readable message describing the debug context.
 * @param data Optional structured context to aid debugging.
 */
function logDebug(message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  console.log(`[${LOG_TAG}] [${timestamp}] DEBUG: ${message}`, data || "");
}

// =============================================================
// Retry Logic
// =============================================================

/**
 * Determine if an error is retryable based on HTTP status or error type
 */
function isRetryableError(error: unknown, httpStatus?: number): boolean {
  // Retry on 5xx server errors
  if (httpStatus && httpStatus >= 500) {
    return true;
  }

  // Retry on specific error patterns
  const errorMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  
  const retryablePatterns = [
    "timeout",
    "timed out",
    "network",
    "econnreset",
    "econnrefused",
    "socket hang up",
    "temporary",
    "unavailable",
    "502 bad gateway",
    "503 service unavailable",
    "504 gateway timeout",
    "plugindaemoninnerror"
  ];

  return retryablePatterns.some(pattern => errorMessage.includes(pattern));
}

/**
 * Execute an operation with exponential backoff retry logic
 */
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  operationName: string,
  config: RetryConfig = RETRY_CONFIG
): Promise<{ result: T; attempts: number }> {
  let lastError: Error;
  let attempt = 0;

  while (attempt <= config.maxRetries) {
    try {
      if (attempt > 0) {
        const delay = Math.min(
          config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt - 1),
          config.maxDelayMs
        );

        logInfo(`Retrying ${operationName}`, {
          attempt: attempt + 1,
          total_attempts: config.maxRetries + 1,
          delay_ms: delay,
        });

        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      const result = await operation();
      
      if (attempt > 0) {
        logInfo(`${operationName} succeeded after ${attempt + 1} attempts`);
      }
      
      return { result, attempts: attempt + 1 };
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      attempt++;

      // Check if we should retry
      const httpStatus = error && typeof error === 'object' && 'httpStatus' in error
        ? (error as { httpStatus: number }).httpStatus
        : undefined;
      const shouldRetry = isRetryableError(error, httpStatus);

      if (attempt > config.maxRetries) {
        logError(
          `${operationName} failed after ${attempt} attempts`,
          {
            error: lastError.message,
            total_attempts: attempt,
          }
        );
        throw lastError;
      }

      if (!shouldRetry) {
        logWarn(
          `${operationName} failed with non-retryable error`,
          {
            error: lastError.message,
            attempt,
          }
        );
        throw lastError;
      }

      logWarn(`${operationName} failed, will retry`, {
        attempt,
        error: lastError.message,
        next_retry_in_ms: Math.min(
          config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt - 1),
          config.maxDelayMs
        ),
      });
    }
  }

  throw lastError!;
}

// =============================================================
// Types & Interfaces
// =============================================================

/**
 * Canonical vehicle data shape persisted to `inspections.vehicle_details`.
 * Keys match human-readable labels used elsewhere in the system.
 */
interface ImageDataExtractResponse {
  Vin: string | null;
  Fuel: string | null;
  Make: string | null;
  Year: number;
  Model: string | null;
  Engine: string | null;
  Mileage: number;
  Location: string | null;
  "Body Style": string | null;
  Drivetrain: string | null;
  "Title Status": string | null;
  Transmission: string | null;
  "Exterior Color": string | null;
  "Interior Color": string | null;
  FullImageText: string | null;
}

/**
 * Individual vehicle property as produced by the LLM analysis layer.
 * When `available` is true, `value` should contain a meaningful value
 * that can be considered for persistence.
 */
interface VehicleProperty {
  available: boolean;
  value: string | number;
}

/**
 * Vehicle object as emitted by the LLM (pre-canonicalization). Field names here
 * use underscores and will be mapped to the persisted keys in
 * {@link ImageDataExtractResponse} by {@link extractAvailableVehicleData}.
 */
interface VehicleData {
  Make?: VehicleProperty;
  Model?: VehicleProperty;
  Year?: VehicleProperty;
  Engine?: VehicleProperty;
  Drivetrain?: VehicleProperty;
  Title_Status?: VehicleProperty;
  Vin?: VehicleProperty;
  Mileage?: VehicleProperty;
  Location?: VehicleProperty;
  Transmission?: VehicleProperty;
  Body_Style?: VehicleProperty;
  Exterior_Color?: VehicleProperty;
  Interior_Color?: VehicleProperty;
  Fuel?: VehicleProperty;
}

/**
 * Root analysis payload as parsed from the `function-call` response.
 * Only a subset is required; the rest is passed through to storage
 * as `llm_analysis` for future auditability.
 */
interface AnalysisResult {
  /** Top-level category, if provided by the model. */
  category?: string;
  /** Nested vehicle attributes discovered by the model. */
  vehicle?: VehicleData;
  /**
   * Arbitrary fields that may exist depending on the model/function prompt,
   * e.g., problems found, OBD decoding, inspection findings, etc.
   */
  problems?: string[];
  obd?: any;
  inspection_findings?: any;
  inspectionResult?: {
    /** Optional nested category (preferred over {@link AnalysisResult.category}). */
    category?: string;
  };
  /** Confidence score (0..1) if the model returns one. */
  confidence?: number;
  /** Freeform reasoning text, if returned by the model. */
  reasoning?: string;
  /** Allow passthrough of additional vendor/model-specific keys. */
  [key: string]: any;
}

// =============================================================
// Utility helpers
// =============================================================

/**
 * Determine whether a candidate value is semantically meaningful for persistence.
 * Rejects empty strings and common placeholders such as "N/A" or "Unknown".
 */
function isMeaningfulValue(value: any): boolean {
  return (
    value &&
    value !== "" &&
    value !== "N/A" &&
    value !== "n/a" &&
    value !== "None" &&
    value !== "none" &&
    value !== "Not Available" &&
    value !== "not available" &&
    value !== "Unknown" &&
    value !== "unknown"
  );
}

/**
 * Check if a VIN is a partial pattern containing wildcards ("*").
 * Asterisk positions are treated as unknown characters.
 */
function isPartialVin(vin: string): boolean {
  return typeof vin === "string" && vin.includes("*");
}

/**
 * Compare a wildcard-containing partial VIN to a complete VIN. Returns true if
 * all non-wildcard characters match positionally (case-insensitive) and the
 * lengths are identical. This is used to approve upgrading a partial VIN to a
 * full VIN when a later analysis provides it.
 */
function vinMatches(partialVin: string, completeVin: string): boolean {
  if (!partialVin || !completeVin) return false;
  if (typeof partialVin !== "string" || typeof completeVin !== "string")
    return false;
  if (partialVin.length !== completeVin.length) return false;

  for (let i = 0; i < partialVin.length; i++) {
    if (partialVin[i] === "*") continue;
    if (partialVin[i].toUpperCase() !== completeVin[i].toUpperCase()) {
      return false;
    }
  }
  return true;
}

/**
 * Decide whether a newly discovered VIN should replace an existing partial VIN.
 * Only returns true if the existing VIN contains wildcards and the new VIN is complete,
 * meaningful, and matches the existing pattern via {@link vinMatches}.
 */
function shouldReplacePartialVin(existingVin: string, newVin: string): boolean {
  if (!existingVin || !newVin) return false;
  const existingIsPartial = isPartialVin(existingVin);
  const newIsComplete = !isPartialVin(newVin) && isMeaningfulValue(newVin);
  if (!existingIsPartial || !newIsComplete) return false;
  return vinMatches(existingVin, newVin);
}

/**
 * Convert the model-provided {@link VehicleData} into a canonical subset suitable for
 * persistence in `inspections.vehicle_details`. Only properties with `available: true`
 * and meaningful values are included. Numeric-looking Year/Mileage strings are parsed
 * into numbers.
 *
 * @param analysisResult The parsed LLM analysis payload.
 * @param inspectionType Optional inspection type (not used for extraction but useful
 *                       to keep for parity with callers and potential future logic).
 * @returns A partial {@link ImageDataExtractResponse} with only the fields to persist.
 */
function extractAvailableVehicleData(
  analysisResult: AnalysisResult,
): Partial<ImageDataExtractResponse> {
  const vehicleDetails: Partial<ImageDataExtractResponse> = {};

  if (!analysisResult.vehicle) {
    return vehicleDetails;
  }

  const keyMapping: Record<string, keyof ImageDataExtractResponse> = {
    Vin: "Vin",
    Make: "Make",
    Model: "Model",
    Year: "Year",
    Engine: "Engine",
    Mileage: "Mileage",
    Location: "Location",
    Body_Style: "Body Style",
    Drivetrain: "Drivetrain",
    Title_Status: "Title Status",
    Transmission: "Transmission",
    Exterior_Color: "Exterior Color",
    Interior_Color: "Interior Color",
    Fuel: "Fuel",
  };

  Object.entries(analysisResult.vehicle).forEach(([key, property]) => {
    if (property && property.available) {
      const dbKey = keyMapping[key];
      if (dbKey) {
        if (!isMeaningfulValue(property.value)) {
          logDebug(
            `Skipping ${dbKey} with non-meaningful value: ${property.value}`
          );
          return;
        }

        if (dbKey === "Year" || dbKey === "Mileage") {
          const numValue =
            typeof property.value === "string"
              ? parseInt(property.value, 10)
              : property.value;
          if (!isNaN(numValue as number)) {
            (vehicleDetails as any)[dbKey] = numValue;
          }
        } else {
          (vehicleDetails as any)[dbKey] = String(property.value);
        }
      }
    }
  });

  return vehicleDetails;
}

// =============================================================
// Persistence helpers (Supabase)
// =============================================================

/**
 * Merge newly extracted vehicle details into the `inspections` row, respecting protection rules
 * for certain inspection types (e.g., `extension` and `detail`). This function may also update the
 * direct `vin` and `mileage` columns when appropriate.
 *
 * Protection rules (high level):
 * - If an existing, meaningful VIN is present for `extension`/`detail`, do not overwrite it
 *   unless the new VIN is a complete match for the partial pattern ({@link shouldReplacePartialVin}).
 * - If mileage already exists meaningfully for `extension`/`detail`, skip mileage updates from gallery images.
 * - When a meaningful VIN exists, skip updating certain dependent attributes from gallery images
 *   (Make, Year, Model, Body Style, Drivetrain, Title Status), assuming the existing VIN-derived data is more authoritative.
 *
 * @param supabase Supabase client (service-role) instance.
 * @param inspectionId ID of the inspection to update.
 * @param vehicleDetails Canonical fields to merge into `vehicle_details`.
 * @param inspectionType Optional inspection type hint to apply protection rules.
 */
async function updateInspectionVehicleDetails(
  supabase: any,
  inspectionId: string,
  vehicleDetails: Record<string, any>,
  inspectionType?: string
): Promise<void> {
  if (Object.keys(vehicleDetails).length === 0) {
    logDebug(
      `No vehicle details to update for inspection ${inspectionId}`
    );
    return;
  }

  try {
    logDebug(
      `Updating inspection ${inspectionId} with vehicle details:`,
      vehicleDetails
    );

    const { data: existingInspection, error: fetchError } = await supabase
      .from("inspections")
      .select("vehicle_details, vin, mileage, type")
      .eq("id", inspectionId)
      .single();

    if (fetchError) {
      logError(
        `Failed to fetch existing vehicle details for inspection ${inspectionId}`,
        fetchError
      );
      throw fetchError;
    }

    const existingVehicleDetails = existingInspection?.vehicle_details || {};
    const existingVin = existingInspection?.vin;
    const existingMileage = existingInspection?.mileage;
    const currentInspectionType = existingInspection?.type || inspectionType;

    const filteredVehicleDetails = { ...vehicleDetails };

    // Protection rules for specific inspection types.
    if (
      currentInspectionType === "extension" ||
      currentInspectionType === "detail"
    ) {
      const existingVinValue = existingVin || existingVehicleDetails.Vin;
      const newVinValue = filteredVehicleDetails.Vin;

      const shouldReplaceVin = shouldReplacePartialVin(
        existingVinValue,
        newVinValue
      );

      const hasMeaningfulVin = isMeaningfulValue(existingVinValue);
      if (hasMeaningfulVin && !shouldReplaceVin) {
        const sourceDescription =
          currentInspectionType === "extension"
            ? "from screenshot"
            : "provided by user";
        logInfo(
          `VIN already exists for ${currentInspectionType} inspection ${inspectionId} (${sourceDescription}), skipping VIN update from gallery image`
        );
        delete filteredVehicleDetails.Vin;
      } else if (shouldReplaceVin) {
        logInfo(
          `Replacing partial VIN "${existingVinValue}" with complete VIN "${newVinValue}" for ${currentInspectionType} inspection ${inspectionId}`
        );
      }

      const hasMeaningfulMileage =
        isMeaningfulValue(existingMileage) ||
        isMeaningfulValue(existingVehicleDetails.Mileage);
      if (hasMeaningfulMileage) {
        const sourceDescription =
          currentInspectionType === "extension"
            ? "from screenshot"
            : "provided by user";
        logInfo(
          `Mileage already exists for ${currentInspectionType} inspection ${inspectionId} (${sourceDescription}), skipping Mileage update from gallery image`
        );
        delete filteredVehicleDetails.Mileage;
      }

      if (hasMeaningfulVin) {
        const protectedFields = [
          "Make",
          "Year",
          "Model",
          "Body Style",
          "Drivetrain",
          "Title Status",
        ];

        protectedFields.forEach((field) => {
          if (filteredVehicleDetails[field] !== undefined) {
            logInfo(
              `VIN exists from screenshot, skipping ${field} update from gallery image analysis`
            );
            delete filteredVehicleDetails[field];
          }
        });
      }
    }

    if (Object.keys(filteredVehicleDetails).length === 0) {
      logInfo(
        `No new vehicle details to update for inspection ${inspectionId} after filtering`
      );
      return;
    }

    const mergedVehicleDetails = {
      ...existingVehicleDetails,
      ...filteredVehicleDetails,
    };

    logInfo(`Merging vehicle details for inspection ${inspectionId}`, {
      existing: existingVehicleDetails,
      new: filteredVehicleDetails,
      merged: mergedVehicleDetails,
      inspection_type: currentInspectionType,
    });

    const updateData: any = { vehicle_details: mergedVehicleDetails };

    if (
      filteredVehicleDetails.Vin &&
      typeof filteredVehicleDetails.Vin === "string"
    ) {
      updateData.vin = filteredVehicleDetails.Vin;
      logInfo(`Also updating vin column with: ${filteredVehicleDetails.Vin}`);
    }

    if (
      filteredVehicleDetails.Mileage &&
      typeof filteredVehicleDetails.Mileage === "number"
    ) {
      updateData.mileage = filteredVehicleDetails.Mileage.toString();
      logInfo(
        `Also updating mileage column with: ${filteredVehicleDetails.Mileage}`
      );
    }

    const { error } = await supabase
      .from("inspections")
      .update(updateData)
      .eq("id", inspectionId);

    if (error) {
      logError(
        `Failed to update inspection ${inspectionId} with vehicle details`,
        error
      );
      throw error;
    }

    logInfo(
      `Successfully updated inspection ${inspectionId} with merged vehicle details and direct columns`
    );
  } catch (error: unknown) {
    logError(`Error updating inspection vehicle details`, error);
    throw error;
  }
}

/**
 * Update a row in `photos` with the determined category and the raw LLM analysis payload.
 * Category defaults to "exterior" if not provided by the model.
 */
async function updatePhotoWithAnalysis(
  supabase: any,
  photoId: string,
  category: string,
  llmAnalysis?: Record<string, unknown>
): Promise<void> {
  try {
    const updateData: any = { category };

    if (llmAnalysis) {
      updateData.llm_analysis = llmAnalysis;
    }

    const { error } = await supabase
      .from("photos")
      .update(updateData)
      .eq("id", photoId);

    if (error) {
      logError(`Failed to update photo ${photoId}`, error);
      throw error;
    }

    logInfo(
      `Successfully updated photo ${photoId} with category: ${category} and LLM analysis`
    );
  } catch (error: unknown) {
    logError(`Error updating photo with analysis`, error);
    throw error;
  }
}

/**
 * Attach LLM analysis to an `obd2_codes` row. OBD images do not carry a category label.
 */
async function updateOBD2WithAnalysis(
  supabase: any,
  obd2Id: string,
  llmAnalysis?: Record<string, unknown>
): Promise<void> {
  try {
    const updateData: any = {};

    if (llmAnalysis) {
      updateData.llm_analysis = llmAnalysis;
    }

    const { error } = await supabase
      .from("obd2_codes")
      .update(updateData)
      .eq("id", obd2Id);

    if (error) {
      logError(`Failed to update OBD2 code ${obd2Id}`, error);
      throw error;
    }

    logInfo(`Successfully updated OBD2 code ${obd2Id} with LLM analysis`);
  } catch (error: unknown) {
    logError(`Error updating OBD2 code with analysis`, error);
    throw error;
  }
}

/**
 * Attach LLM analysis to a `title_images` row. Title images do not carry a category label.
 */
async function updateTitleImageWithAnalysis(
  supabase: any,
  titleImageId: string,
  llmAnalysis?: Record<string, unknown>
): Promise<void> {
  try {
    const updateData: any = {};

    if (llmAnalysis) {
      updateData.llm_analysis = llmAnalysis;
    }

    const { error } = await supabase
      .from("title_images")
      .update(updateData)
      .eq("id", titleImageId);

    if (error) {
      logError(`Failed to update title image ${titleImageId}`, error);
      throw error;
    }

    logInfo(
      `Successfully updated title image ${titleImageId} with LLM analysis`
    );
  } catch (error: unknown) {
    logError(`Error updating title image with analysis`, error);
    throw error;
  }
}

// =============================================================
// Function Call with Fallback
// =============================================================

/**
 * Call the function-call Edge Function with fallback support.
 * First tries with the primary function, then falls back to v2 if it fails.
 * 
 * @param supabaseUrl Supabase URL
 * @param supabaseServiceKey Service role key
 * @param imageUrl Image URL to analyze
 * @param inspectionId Inspection ID
 * @param userId User ID
 * @returns Object containing the analysis result, number of attempts, and function used
 */
async function callFunctionWithFallback(
  supabaseUrl: string,
  supabaseServiceKey: string,
  imageUrl: string,
  inspectionId: string,
  userId?: string
): Promise<{ data: any; attempts: number; functionUsed: string }> {
  const functionNames = ["image_details_extraction", "image_details_extraction_v2"];
  let lastError: Error;
  let totalAttempts = 0;

  for (const functionName of functionNames) {
    try {
      logInfo(`Attempting to call function: ${functionName}`);

      const functionCallPayload = {
        function_name: functionName,
        query: "Provide the results with the image url",
        inspection_id: inspectionId,
        user_id: userId,
        files: [
          {
            type: "image",
            transfer_method: "remote_url",
            url: imageUrl,
          },
        ],
      };

      logDebug("Calling function-call service", {
        function_name: functionName,
        inspection_id: inspectionId,
      });

      const { result: data, attempts } = await retryWithBackoff(
        async () => {
          const response = await fetch(`${supabaseUrl}/functions/v1/function-call`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify(functionCallPayload),
          });

          if (!response.ok) {
            const errorText = await response.text();
            const error = new Error(
              `Function-call failed: HTTP ${response.status}: ${errorText}`
            ) as Error & { httpStatus: number };
            error.httpStatus = response.status;
            throw error;
          }

          const data = await response.json();

          if (!data.success || !data.payload) {
            throw new Error(`Function call failed: ${JSON.stringify(data)}`);
          }

          return data;
        },
        `${functionName} API request`
      );

      totalAttempts += attempts;
      
      logInfo(`Function ${functionName} succeeded`, {
        attempts,
        total_attempts: totalAttempts,
      });

      return { data, attempts: totalAttempts, functionUsed: functionName };

    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      totalAttempts += RETRY_CONFIG.maxRetries + 1; // Add max attempts for this function

      // If this is not the last function, log and continue to next
      if (functionName !== functionNames[functionNames.length - 1]) {
        logWarn(
          `Function ${functionName} failed after all retries, trying fallback`,
          {
            error: lastError.message,
            next_function: functionNames[functionNames.indexOf(functionName) + 1],
          }
        );
      } else {
        // This was the last function, throw the error
        logError(
          `All functions failed after ${totalAttempts} total attempts`,
          {
            error: lastError.message,
            functions_tried: functionNames,
          }
        );
        throw lastError;
      }
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError!;
}

// =============================================================
// Main HTTP handler
// =============================================================

Deno.serve(async (req) => {
  // Handle CORS preflight early and return immediately.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    // --- Parse & validate request ---
    const body = await req.json();
    const {
      image_url,
      image_id,
      image_type = "photo", // 'photo', 'obd2', 'title'
      inspection_id,
      user_id,
      inspection_type,
    } = body;

    logInfo("Categorize image request received", {
      image_url: image_url?.substring(0, 50) + "...",
      image_id,
      image_type,
      inspection_id,
      user_id: user_id ? "[PRESENT]" : "[MISSING]",
      inspection_type,
    });

    if (!image_url || !image_id || !inspection_id) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required fields: image_url, image_id, inspection_id",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // --- Initialize Supabase ---
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // --- Invoke function-call Edge Function with fallback support ---
    const { data, attempts, functionUsed } = await callFunctionWithFallback(
      supabaseUrl,
      supabaseServiceKey,
      image_url,
      inspection_id,
      user_id
    );

    logDebug("Function-call response received", {
      payload_length: data.payload.length,
      attempts,
      function_used: functionUsed,
    });

    // --- Parse LLM JSON payload (supports fenced json blocks) ---
    let jsonString = data.payload as string;

    // Prefer fenced ```json blocks if present to avoid stray text
    const jsonMatch = jsonString.match(/```json\s*\n([\s\S]*?)\n\s*```/);
    if (jsonMatch) {
      jsonString = jsonMatch[1];
    } else {
      // Fallback: best-effort capture of the first JSON object
      const jsonObjectMatch = jsonString.match(/\{[\s\S]*\}/);
      if (jsonObjectMatch) {
        jsonString = jsonObjectMatch[0];
      }
    }

    const answerJson: AnalysisResult = JSON.parse(jsonString.trim());

    // --- Extract & persist vehicle details at the inspection level ---
    if (answerJson.vehicle) {
      const vehicleDetails = extractAvailableVehicleData(
        answerJson,
      );
      if (Object.keys(vehicleDetails).length > 0) {
        logInfo("Updating vehicle details for inspection", {
          inspection_type,
          fields: Object.keys(vehicleDetails),
        });
        await updateInspectionVehicleDetails(
          supabase,
          inspection_id,
          vehicleDetails,
          inspection_type
        );
      }
    }

    // --- Prepare analysis for per-resource storage (exclude nested vehicle) ---
    const analysisWithoutVehicle = { ...answerJson } as any;
    delete analysisWithoutVehicle.vehicle;

    const category =
      answerJson.inspectionResult?.category ||
      answerJson.category ||
      "exterior";

    // --- Update the resource row based on image type ---
    if (image_type === "photo") {
      await updatePhotoWithAnalysis(
        supabase,
        image_id,
        category,
        analysisWithoutVehicle
      );
    } else if (image_type === "obd2") {
      await updateOBD2WithAnalysis(supabase, image_id, analysisWithoutVehicle);
    } else if (image_type === "title") {
      await updateTitleImageWithAnalysis(
        supabase,
        image_id,
        analysisWithoutVehicle
      );
    }

    // --- Success response ---
    const duration = Date.now() - startTime;

    logInfo("Image categorization completed successfully", {
      image_id,
      category,
      duration_ms: duration,
      has_vehicle_data: !!answerJson.vehicle,
      function_used: functionUsed,
    });

    return new Response(
      JSON.stringify({
        success: true,
        image_id,
        category,
        confidence: answerJson.confidence || 1.0,
        reasoning: answerJson.reasoning || "No reasoning provided",
        has_vehicle_data: !!answerJson.vehicle,
        duration_ms: duration,
        attempts,
        function_used: functionUsed,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    // --- Error handling ---
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    logError("Image categorization failed", {
      error: errorMessage,
      stack: errorStack,
      duration_ms: duration,
    });

    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage || "Internal server error",
        duration_ms: duration,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
