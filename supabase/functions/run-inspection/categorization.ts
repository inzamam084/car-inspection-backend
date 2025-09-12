import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabase } from "./config.ts";
import { createDatabaseService } from "../shared/database-service.ts";
import type {
  Photo,
  OBD2Code,
  TitleImage,
  ImageCategorizationResult,
} from "./schemas.ts";

// Retry configuration for image categorization
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000, // Start with 1 second
  maxDelayMs: 10000, // Cap at 10 seconds
  backoffMultiplier: 2,
};

// Helper function for retry with exponential backoff
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  operationName: string,
  config = RETRY_CONFIG
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = Math.min(
          config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt - 1),
          config.maxDelayMs
        );

        console.log(`Retrying ${operationName}`, {
          attempt: attempt + 1,
          maxRetries: config.maxRetries + 1,
          delayMs: delay,
        });

        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      return await operation();
    } catch (error) {
      lastError = error as Error;

      if (attempt === config.maxRetries) {
        console.error(
          `${operationName} failed after ${config.maxRetries + 1} attempts`,
          {
            error: lastError.message,
            totalAttempts: attempt + 1,
          }
        );
        throw lastError;
      }

      console.warn(`${operationName} failed, will retry`, {
        attempt: attempt + 1,
        error: lastError.message,
        nextRetryIn: Math.min(
          config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt),
          config.maxDelayMs
        ),
      });
    }
  }

  throw lastError!;
}

// Initialize database service
const dbService = createDatabaseService();

/**
 * Helper function to check if a value is meaningful (not null, undefined, empty, or placeholder values)
 */
function isMeaningfulValue(value: any): boolean {
  return value && 
         value !== "" && 
         value !== "N/A" && 
         value !== "n/a" && 
         value !== "None" && 
         value !== "none" &&
         value !== "Not Available" &&
         value !== "not available" &&
         value !== "Unknown" &&
         value !== "unknown";
}

/**
 * Helper function to check if a VIN is partially redacted (contains asterisks)
 */
function isPartialVin(vin: string): boolean {
  return typeof vin === 'string' && vin.includes('*');
}

/**
 * Helper function to compare a partial VIN (with asterisks) with a complete VIN
 * Returns true if the non-asterisk portions match
 */
function vinMatches(partialVin: string, completeVin: string): boolean {
  if (!partialVin || !completeVin) return false;
  if (typeof partialVin !== 'string' || typeof completeVin !== 'string') return false;
  
  // Ensure both VINs are the same length (standard VIN is 17 characters)
  if (partialVin.length !== completeVin.length) return false;
  
  // Compare character by character, ignoring asterisks in partial VIN
  for (let i = 0; i < partialVin.length; i++) {
    if (partialVin[i] === '*') {
      continue; // Skip asterisks in partial VIN
    }
    if (partialVin[i].toUpperCase() !== completeVin[i].toUpperCase()) {
      return false; // Non-asterisk characters must match
    }
  }
  
  return true;
}

/**
 * Helper function to check if a complete VIN should replace a partial VIN
 * Returns true if:
 * 1. Existing VIN is partial (contains asterisks) AND
 * 2. New VIN is complete (no asterisks) AND  
 * 3. The non-asterisk portions match
 */
function shouldReplacePartialVin(existingVin: string, newVin: string): boolean {
  if (!existingVin || !newVin) return false;
  
  // Only replace if existing VIN is partial and new VIN is complete
  const existingIsPartial = isPartialVin(existingVin);
  const newIsComplete = !isPartialVin(newVin) && isMeaningfulValue(newVin);
  
  if (!existingIsPartial || !newIsComplete) return false;
  
  // Check if the non-asterisk portions match
  return vinMatches(existingVin, newVin);
}

// Interface for vehicle data structure (matching the actual database structure)
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

// Interface for vehicle data structure from analysis result
interface VehicleProperty {
  available: boolean;
  value: string | number;
}

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

interface AnalysisResult {
  category?: string;
  vehicle?: VehicleData;
  problems?: string[];
  obd?: any;
  inspection_findings?: any;
  [key: string]: any;
}

/**
 * Extract available vehicle data from analysis result and map to database format
 */
function extractAvailableVehicleData(
  analysisResult: AnalysisResult,
  inspectionType?: string
): Partial<ImageDataExtractResponse> {
  const vehicleDetails: Partial<ImageDataExtractResponse> = {};

  if (!analysisResult.vehicle) {
    return vehicleDetails;
  }

  // Mapping from analysis result keys to database format keys
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

  // Extract only available vehicle properties and map to database format
  // Note: VIN and Mileage protection is now handled in updateInspectionVehicleDetails()
  Object.entries(analysisResult.vehicle).forEach(([key, property]) => {
    if (property && property.available) {
      const dbKey = keyMapping[key];
      if (dbKey) {
        // Skip if value is "N/A" or other non-meaningful values
        if (!isMeaningfulValue(property.value)) {
          console.log(`Skipping ${dbKey} with non-meaningful value: ${property.value}`);
          return;
        }

        // Handle type conversion for numeric fields
        if (dbKey === "Year" || dbKey === "Mileage") {
          const numValue =
            typeof property.value === "string"
              ? parseInt(property.value, 10)
              : property.value;
          if (!isNaN(numValue as number)) {
            (vehicleDetails as any)[dbKey] = numValue;
          }
        } else {
          // For string fields, ensure we store as string
          (vehicleDetails as any)[dbKey] = String(property.value);
        }
      }
    }
  });

  return vehicleDetails;
}

/**
 * Update inspection with vehicle details
 */
async function updateInspectionVehicleDetails(
  inspectionId: string,
  vehicleDetails: Record<string, any>,
  inspectionType?: string
): Promise<void> {
  if (Object.keys(vehicleDetails).length === 0) {
    console.log(`No vehicle details to update for inspection ${inspectionId}`);
    return;
  }

  try {
    console.log(
      `Updating inspection ${inspectionId} with vehicle details:`,
      vehicleDetails
    );

    // First, fetch the existing vehicle_details, vin, mileage, and type
    const { data: existingInspection, error: fetchError } = await dbService
      .getClient()
      .from("inspections")
      .select("vehicle_details, vin, mileage, type")
      .eq("id", inspectionId)
      .single();

    if (fetchError) {
      console.error(
        `Failed to fetch existing vehicle details for inspection ${inspectionId}:`,
        fetchError
      );
      throw fetchError;
    }

    const existingVehicleDetails = existingInspection?.vehicle_details || {};
    const existingVin = existingInspection?.vin;
    const existingMileage = existingInspection?.mileage;
    const currentInspectionType = existingInspection?.type || inspectionType;

    // For extension and detail type inspections, protect VIN and Mileage from being overwritten
    // - Extension: VIN/Mileage extracted from screenshot should not be overwritten
    // - Detail: VIN/Mileage provided by user should not be overwritten
    const filteredVehicleDetails = { ...vehicleDetails };

    if (
      currentInspectionType === "extension" ||
      currentInspectionType === "detail"
    ) {
      // Check if VIN already exists in database (meaningful value)
      const existingVinValue = existingVin || existingVehicleDetails.Vin;
      const newVinValue = filteredVehicleDetails.Vin;
      
      // Special case: Allow replacement if existing VIN is partial and new VIN completes it
      const shouldReplaceVin = shouldReplacePartialVin(existingVinValue, newVinValue);
      
      const hasMeaningfulVin = isMeaningfulValue(existingVinValue);
      if (hasMeaningfulVin && !shouldReplaceVin) {
        const sourceDescription =
          currentInspectionType === "extension"
            ? "from screenshot"
            : "provided by user";
        console.log(
          `VIN already exists for ${currentInspectionType} inspection ${inspectionId} (${sourceDescription}), skipping VIN update from gallery image`
        );
        delete filteredVehicleDetails.Vin;
      } else if (shouldReplaceVin) {
        console.log(
          `Replacing partial VIN "${existingVinValue}" with complete VIN "${newVinValue}" for ${currentInspectionType} inspection ${inspectionId}`
        );
        // Keep the VIN in filteredVehicleDetails to allow the update
      }

      // Check if Mileage already exists in database (meaningful value)
      const hasMeaningfulMileage = isMeaningfulValue(existingMileage) || isMeaningfulValue(existingVehicleDetails.Mileage);
      if (hasMeaningfulMileage) {
        const sourceDescription =
          currentInspectionType === "extension"
            ? "from screenshot"
            : "provided by user";
        console.log(
          `Mileage already exists for ${currentInspectionType} inspection ${inspectionId} (${sourceDescription}), skipping Mileage update from gallery image`
        );
        delete filteredVehicleDetails.Mileage;
      }

      // NEW LOGIC: If VIN exists from screenshot, protect specific fields from gallery image updates
      if (hasMeaningfulVin) {
        const protectedFields = [
          "Make",
          "Year", 
          "Model",
          "Engine",
          "Body Style",
          "Drivetrain",
          "Title Status",
          "Transmission"
        ];
        
        protectedFields.forEach(field => {
          if (filteredVehicleDetails[field] !== undefined) {
            console.log(
              `VIN exists from skipping ${field} update from gallery image analysis`
            );
            delete filteredVehicleDetails[field];
          }
        });
      }
    }

    // If no vehicle details remain after filtering, skip the update
    if (Object.keys(filteredVehicleDetails).length === 0) {
      console.log(
        `No new vehicle details to update for inspection ${inspectionId} after filtering`
      );
      return;
    }

    // Merge existing vehicle details with new filtered ones
    const mergedVehicleDetails = {
      ...existingVehicleDetails,
      ...filteredVehicleDetails,
    };

    console.log(`Merging vehicle details for inspection ${inspectionId}:`, {
      existing: existingVehicleDetails,
      new: filteredVehicleDetails,
      merged: mergedVehicleDetails,
      inspection_type: currentInspectionType,
    });

    // Prepare update data - always include vehicle_details
    const updateData: any = { vehicle_details: mergedVehicleDetails };

    // If VIN is available in filtered data, also update the vin column
    if (
      filteredVehicleDetails.Vin &&
      typeof filteredVehicleDetails.Vin === "string"
    ) {
      updateData.vin = filteredVehicleDetails.Vin;
      console.log(
        `Also updating vin column with: ${filteredVehicleDetails.Vin}`
      );
    }

    // If Mileage is available in filtered data, also update the mileage column
    if (
      filteredVehicleDetails.Mileage &&
      typeof filteredVehicleDetails.Mileage === "number"
    ) {
      updateData.mileage = filteredVehicleDetails.Mileage.toString();
      console.log(
        `Also updating mileage column with: ${filteredVehicleDetails.Mileage}`
      );
    }

    const { error } = await dbService
      .getClient()
      .from("inspections")
      .update(updateData)
      .eq("id", inspectionId);

    if (error) {
      console.error(
        `Failed to update inspection ${inspectionId} with vehicle details:`,
        error
      );
      throw error;
    }

    console.log(
      `Successfully updated inspection ${inspectionId} with merged vehicle details and direct columns`
    );
  } catch (error) {
    console.error(`Error updating inspection vehicle details:`, error);
    throw error;
  }
}

/**
 * Categorize a single image using function-call edge function
 */
export async function categorizeImage(
  imageUrl: string,
  inspectionId?: string,
  inspectionType?: string,
  userId?: string
): Promise<ImageCategorizationResult | null> {
  try {
    console.log(`Categorizing image: ${imageUrl}`);

    // Prepare the request payload for function-call edge function
    const functionCallPayload = {
      function_name: "image_details_extraction",
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

    // Get Supabase URL and service key for internal function call
    // @ts-ignore: Deno global is available in Supabase Edge Functions
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    // @ts-ignore: Deno global is available in Supabase Edge Functions
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Missing Supabase configuration for function call");
      return null;
    }

    // Call the function-call edge function with retry logic
    let data;
    try {
      data = await retryWithBackoff(async () => {
        const response = await fetch(
          `${supabaseUrl}/functions/v1/function-call`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify(functionCallPayload),
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();

        if (!data.success || !data.payload) {
          throw new Error(`Function call failed: ${JSON.stringify(data)}`);
        }

        return data;
      }, `image categorization for ${imageUrl}`);

      console.log(`Function-call response for ${imageUrl}:`, data);
    } catch (error) {
      console.warn(
        `Image categorization failed after retries for ${imageUrl}, skipping`,
        {
          error: (error as Error).message,
        }
      );
      return null;
    }

    // Parse the JSON response from the payload field
    try {
      // Extract JSON from the response that may contain explanatory text
      let jsonString = data.payload;
      console.log("Raw function-call payload:", jsonString);

      // Look for JSON block between ```json and ``` markers
      const jsonMatch = jsonString.match(/```json\s*\n([\s\S]*?)\n\s*```/);
      if (jsonMatch) {
        jsonString = jsonMatch[1];
      } else {
        // If no markdown code block, try to find JSON object directly
        const jsonObjectMatch = jsonString.match(/\{[\s\S]*\}/);
        if (jsonObjectMatch) {
          jsonString = jsonObjectMatch[0];
        }
      }

      const answerJson = JSON.parse(jsonString.trim());

      // Use the analysis result directly without re-running for VIN verification
      let finalAnalysisResult = answerJson;
      const vehicleDetails = extractAvailableVehicleData(
        answerJson,
        inspectionType
      );
      const vinDetected =
        vehicleDetails.Vin && vehicleDetails.Vin.trim() !== "";

      if (vinDetected) {
        console.log(
          `VIN detected (${vehicleDetails.Vin}) from image analysis - using result directly without re-verification`
        );
      }

      // Extract vehicle data from final analysis result and update inspection
      // VIN and Mileage protection is now handled within updateInspectionVehicleDetails()
      if (inspectionId && finalAnalysisResult.vehicle) {
        const finalVehicleDetails = extractAvailableVehicleData(
          finalAnalysisResult,
          inspectionType
        );
        if (Object.keys(finalVehicleDetails).length > 0) {
          console.log(
            `Updating vehicle details for inspection type: ${inspectionType}`
          );
          await updateInspectionVehicleDetails(
            inspectionId,
            finalVehicleDetails,
            inspectionType
          );
        }
      }

      // Create a copy of the analysis without vehicle data for fullAnalysis
      const analysisWithoutVehicle = { ...finalAnalysisResult };
      delete analysisWithoutVehicle.vehicle;

      const result: ImageCategorizationResult = {
        category:
          finalAnalysisResult.inspectionResult?.category ||
          finalAnalysisResult.category ||
          "exterior",
        confidence: finalAnalysisResult.confidence || 1.0,
        reasoning: finalAnalysisResult.reasoning || "No reasoning provided",
        fullAnalysis: analysisWithoutVehicle,
      };

      console.log(
        `Image categorized as: ${result.category} (confidence: ${result.confidence})`
      );
      return result;
    } catch (parseError) {
      console.error("Failed to parse function-call response:", parseError);
      console.error("Raw payload:", data.payload);
      return null;
    }
  } catch (error) {
    console.error(`Error categorizing image ${imageUrl}:`, error);
    return null;
  }
}

/**
 * Categorize multiple images in batch - supports photos, OBD2 codes, and title images
 */
export async function categorizeImages(
  photos: Photo[],
  inspectionId?: string,
  obd2Codes?: OBD2Code[],
  titleImages?: TitleImage[],
  inspectionType?: string,
  userId?: string
): Promise<void> {
  const totalImages =
    photos.length + (obd2Codes?.length || 0) + (titleImages?.length || 0);
  console.log(
    `Starting categorization for ${totalImages} images (${
      photos.length
    } photos, ${obd2Codes?.length || 0} OBD2 codes, ${
      titleImages?.length || 0
    } title images)`
  );

  const categorizePromises: Promise<void>[] = [];

  // Process regular photos
  photos.forEach((photo) => {
    categorizePromises.push(
      (async () => {
        try {
          const result = await categorizeImage(
            photo.path,
            inspectionId,
            inspectionType,
            userId
          );
          if (result) {
            await updatePhotoWithAnalysis(
              photo.id,
              result.category,
              result.fullAnalysis
            );
            console.log(
              `Updated photo ${photo.id} with category: ${result.category}`
            );
          } else {
            console.warn(
              `Failed to categorize photo ${photo.id}, keeping existing category: ${photo.category}`
            );
          }
        } catch (error) {
          console.error(`Error processing photo ${photo.id}:`, error);
        }
      })()
    );
  });

  // Process OBD2 codes with images (where code = "IMG")
  if (obd2Codes) {
    const obd2ImagesWithScreenshots = obd2Codes.filter(
      (obd2) => obd2.code === "IMG" && obd2.screenshot_path
    );

    console.log(
      `Found ${obd2ImagesWithScreenshots.length} OBD2 codes with images to process`
    );

    obd2ImagesWithScreenshots.forEach((obd2) => {
      categorizePromises.push(
        (async () => {
          try {
            const result = await categorizeImage(
              obd2.screenshot_path!,
              inspectionId,
              inspectionType,
              userId
            );
            if (result) {
              await updateOBD2WithAnalysis(obd2.id, result.fullAnalysis);
              console.log(`Updated OBD2 code ${obd2.id} with analysis`);
            } else {
              console.warn(`Failed to categorize OBD2 code ${obd2.id}`);
            }
          } catch (error) {
            console.error(`Error processing OBD2 code ${obd2.id}:`, error);
          }
        })()
      );
    });
  }

  // Process title images
  if (titleImages) {
    console.log(`Processing ${titleImages.length} title images`);

    titleImages.forEach((titleImage) => {
      categorizePromises.push(
        (async () => {
          try {
            const result = await categorizeImage(
              titleImage.path,
              inspectionId,
              inspectionType,
              userId
            );
            if (result) {
              await updateTitleImageWithAnalysis(
                titleImage.id,
                result.fullAnalysis
              );
              console.log(`Updated title image ${titleImage.id} with analysis`);
            } else {
              console.warn(`Failed to categorize title image ${titleImage.id}`);
            }
          } catch (error) {
            console.error(
              `Error processing title image ${titleImage.id}:`,
              error
            );
          }
        })()
      );
    });
  }

  // Process images with some concurrency but not too many at once to avoid rate limits
  const batchSize = 3;
  for (let i = 0; i < categorizePromises.length; i += batchSize) {
    const batch = categorizePromises.slice(i, i + batchSize);
    await Promise.all(batch);

    // Add a small delay between batches to be respectful to the API
    if (i + batchSize < categorizePromises.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  console.log(`Completed categorization for ${totalImages} images`);
}

/**
 * Update photo category and LLM analysis in the database
 */
async function updatePhotoWithAnalysis(
  photoId: string,
  category: string,
  llmAnalysis?: any
): Promise<void> {
  try {
    const updateData: any = { category };

    // Add llm_analysis if provided
    if (llmAnalysis) {
      updateData.llm_analysis = llmAnalysis;
    }

    const { error } = await dbService
      .getClient()
      .from("photos")
      .update(updateData)
      .eq("id", photoId);

    if (error) {
      console.error(`Failed to update photo ${photoId}:`, error);
      throw error;
    }

    console.log(
      `Successfully updated photo ${photoId} with category: ${category} and LLM analysis`
    );
  } catch (error) {
    console.error(`Error updating photo with analysis:`, error);
    throw error;
  }
}

/**
 * Update OBD2 code with LLM analysis in the database
 */
async function updateOBD2WithAnalysis(
  obd2Id: string,
  llmAnalysis?: any
): Promise<void> {
  try {
    const updateData: any = {};

    // Add llm_analysis if provided
    if (llmAnalysis) {
      updateData.llm_analysis = llmAnalysis;
    }

    const { error } = await dbService
      .getClient()
      .from("obd2_codes")
      .update(updateData)
      .eq("id", obd2Id);

    if (error) {
      console.error(`Failed to update OBD2 code ${obd2Id}:`, error);
      throw error;
    }

    console.log(`Successfully updated OBD2 code ${obd2Id} with LLM analysis`);
  } catch (error) {
    console.error(`Error updating OBD2 code with analysis:`, error);
    throw error;
  }
}

/**
 * Update title image with LLM analysis in the database
 */
async function updateTitleImageWithAnalysis(
  titleImageId: string,
  llmAnalysis?: any
): Promise<void> {
  try {
    const updateData: any = {};

    // Add llm_analysis if provided
    if (llmAnalysis) {
      updateData.llm_analysis = llmAnalysis;
    }

    const { error } = await dbService
      .getClient()
      .from("title_images")
      .update(updateData)
      .eq("id", titleImageId);

    if (error) {
      console.error(`Failed to update title image ${titleImageId}:`, error);
      throw error;
    }

    console.log(
      `Successfully updated title image ${titleImageId} with LLM analysis`
    );
  } catch (error) {
    console.error(`Error updating title image with analysis:`, error);
    throw error;
  }
}
