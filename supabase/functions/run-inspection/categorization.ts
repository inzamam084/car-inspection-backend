import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabase } from "./config.ts";
import { createDatabaseService } from "../shared/database-service.ts";
import type {
  Photo,
  OBD2Code,
  TitleImage,
  ImageCategorizationResult,
} from "./schemas.ts";

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
  analysisResult: AnalysisResult
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
  Object.entries(analysisResult.vehicle).forEach(([key, property]) => {
    if (property && property.available && property.value !== "N/A") {
      const dbKey = keyMapping[key];
      if (dbKey) {
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

    console.log(`Merging vehicle details for inspection ${inspectionId}:`, {
      existing: existingVehicleDetails,
      new: vehicleDetails,
      merged: mergedVehicleDetails,
    });

    // Prepare update data - always include vehicle_details
    const updateData: any = { vehicle_details: mergedVehicleDetails };

    // If VIN is available, also update the vin column
    if (vehicleDetails.Vin && typeof vehicleDetails.Vin === "string") {
      updateData.vin = vehicleDetails.Vin;
      console.log(`Also updating vin column with: ${vehicleDetails.Vin}`);
    }

    // If Mileage is available, also update the mileage column
    if (vehicleDetails.Mileage && typeof vehicleDetails.Mileage === "number") {
      updateData.mileage = vehicleDetails.Mileage.toString();
      console.log(
        `Also updating mileage column with: ${vehicleDetails.Mileage}`
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

      // Check if VIN was detected in the first analysis
      let finalAnalysisResult = answerJson;
      const vehicleDetails = extractAvailableVehicleData(answerJson);
      const vinDetected = vehicleDetails.Vin && vehicleDetails.Vin.trim() !== "";

      // If VIN is detected, re-run the function call for verification
      if (vinDetected) {
        console.log(`VIN detected (${vehicleDetails.Vin}), re-running analysis for verification...`);
        
        try {
          // Make a second function call for VIN verification
          const verificationResponse = await fetch(`${supabaseUrl}/functions/v1/function-call`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              ...functionCallPayload,
              query: "Re-analyze this image with special focus on VIN detection accuracy."
            }),
          });

          if (verificationResponse.ok) {
            const verificationData = await verificationResponse.json();
            console.log(`VIN verification response for ${imageUrl}:`, verificationData);

            if (verificationData.success && verificationData.payload) {
              // Parse the verification response
              let verificationJsonString = verificationData.payload;
              
              // Look for JSON block between ```json and ``` markers
              const verificationJsonMatch = verificationJsonString.match(/```json\s*\n([\s\S]*?)\n\s*```/);
              if (verificationJsonMatch) {
                verificationJsonString = verificationJsonMatch[1];
              } else {
                // If no markdown code block, try to find JSON object directly
                const verificationJsonObjectMatch = verificationJsonString.match(/\{[\s\S]*\}/);
                if (verificationJsonObjectMatch) {
                  verificationJsonString = verificationJsonObjectMatch[0];
                }
              }

              try {
                const verificationJson = JSON.parse(verificationJsonString.trim());
                console.log(`Using verification analysis result for ${imageUrl}`);
                finalAnalysisResult = verificationJson;
              } catch (verificationParseError) {
                console.warn(`Failed to parse verification response, using original analysis:`, verificationParseError);
                // Keep using the original analysis result
              }
            } else {
              console.warn(`Verification call unsuccessful, using original analysis`);
            }
          } else {
            console.warn(`Verification call failed with status ${verificationResponse.status}, using original analysis`);
          }
        } catch (verificationError) {
          console.warn(`Error during VIN verification, using original analysis:`, verificationError);
          // Continue with original analysis
        }
      }

      // Extract vehicle data from final analysis result and update inspection
      if (inspectionId && finalAnalysisResult.vehicle) {
        const finalVehicleDetails = extractAvailableVehicleData(finalAnalysisResult);
        if (Object.keys(finalVehicleDetails).length > 0) {
          await updateInspectionVehicleDetails(inspectionId, finalVehicleDetails);
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
  titleImages?: TitleImage[]
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
              inspectionId
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
            const result = await categorizeImage(titleImage.path, inspectionId);
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
