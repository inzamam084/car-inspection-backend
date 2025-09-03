import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabase } from "./config.ts";
import { createDatabaseService } from "../shared/database-service.ts";
import type { Photo, ImageCategorizationResult } from "./schemas.ts";

// Initialize database service
const dbService = createDatabaseService();

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
  VIN?: VehicleProperty;
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
  analysisResult: AnalysisResult
): Partial<ImageDataExtractResponse> {
  const vehicleDetails: Partial<ImageDataExtractResponse> = {};

  if (!analysisResult.vehicle) {
    return vehicleDetails;
  }

  // Mapping from analysis result keys to database format keys
  const keyMapping: Record<string, keyof ImageDataExtractResponse> = {
    VIN: "Vin",
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
  Object.entries(analysisResult.vehicle).forEach(([key, property]) => {
    if (property && property.available && property.value !== "N/A") {
      const dbKey = keyMapping[key];
      if (dbKey) {
        // Handle type conversion for numeric fields
        if (dbKey === "Year" || dbKey === "Mileage") {
          const numValue = typeof property.value === "string" 
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
  vehicleDetails: Record<string, any>
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

    // First, fetch the existing vehicle_details
    const { data: existingInspection, error: fetchError } = await dbService
      .getClient()
      .from("inspections")
      .select("vehicle_details")
      .eq("id", inspectionId)
      .single();

    if (fetchError) {
      console.error(
        `Failed to fetch existing vehicle details for inspection ${inspectionId}:`,
        fetchError
      );
      throw fetchError;
    }

    // Merge existing vehicle details with new ones
    const existingVehicleDetails = existingInspection?.vehicle_details || {};
    const mergedVehicleDetails = {
      ...existingVehicleDetails,
      ...vehicleDetails,
    };

    console.log(
      `Merging vehicle details for inspection ${inspectionId}:`,
      {
        existing: existingVehicleDetails,
        new: vehicleDetails,
        merged: mergedVehicleDetails,
      }
    );

    const { error } = await dbService
      .getClient()
      .from("inspections")
      .update({ vehicle_details: mergedVehicleDetails })
      .eq("id", inspectionId);

    if (error) {
      console.error(
        `Failed to update inspection ${inspectionId} with vehicle details:`,
        error
      );
      throw error;
    }

    console.log(
      `Successfully updated inspection ${inspectionId} with merged vehicle details`
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
  inspectionId?: string
): Promise<ImageCategorizationResult | null> {
  try {
    console.log(`Categorizing image: ${imageUrl}`);

    // Prepare the request payload for function-call edge function
    const functionCallPayload = {
      function_name: "image_details_extraction",
      query: "Provide the results with the image url",
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

    // Call the function-call edge function
    const response = await fetch(`${supabaseUrl}/functions/v1/function-call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify(functionCallPayload),
    });

    if (!response.ok) {
      console.error(
        `Function-call request failed: ${response.status} ${response.statusText}`
      );
      const errorText = await response.text();
      console.error("Error response:", errorText);
      return null;
    }

    const data = await response.json();
    console.log(`Function-call response for ${imageUrl}:`, data);

    if (!data.success || !data.payload) {
      console.error("Function-call returned unsuccessful response:", data);
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

      // Extract vehicle data if available and update inspection
      if (inspectionId && answerJson.vehicle) {
        const vehicleDetails = extractAvailableVehicleData(answerJson);
        if (Object.keys(vehicleDetails).length > 0) {
          await updateInspectionVehicleDetails(inspectionId, vehicleDetails);
        }
      }

      // Create a copy of the analysis without vehicle data for fullAnalysis
      const analysisWithoutVehicle = { ...answerJson };
      delete analysisWithoutVehicle.vehicle;

      const result: ImageCategorizationResult = {
        category:
          answerJson.inspectionResult?.category ||
          answerJson.category ||
          "exterior",
        confidence: answerJson.confidence || 1.0,
        reasoning: answerJson.reasoning || "No reasoning provided",
        fullAnalysis: analysisWithoutVehicle, // Store analysis without vehicle data
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
 * Categorize multiple images in batch
 */
export async function categorizeImages(
  photos: Photo[],
  inspectionId?: string
): Promise<void> {
  console.log(`Starting categorization for ${photos.length} images`);

  const categorizePromises = photos.map(async (photo) => {
    try {
      const result = await categorizeImage(photo.path, inspectionId);
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
  });

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

  console.log(`Completed categorization for ${photos.length} images`);
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
