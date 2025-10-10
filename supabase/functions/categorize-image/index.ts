import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Logging configuration
const LOG_TAG = "CATEGORIZE_IMAGE";

function logInfo(message: string, data?: any): void {
  const timestamp = new Date().toISOString();
  console.log(`[${LOG_TAG}] [${timestamp}] INFO: ${message}`, data || "");
}

function logError(message: string, error?: any): void {
  const timestamp = new Date().toISOString();
  console.error(`[${LOG_TAG}] [${timestamp}] ERROR: ${message}`, error || "");
}

function logDebug(message: string, data?: any): void {
  const timestamp = new Date().toISOString();
  console.log(`[${LOG_TAG}] [${timestamp}] DEBUG: ${message}`, data || "");
}

// Interface for vehicle data structure
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
  inspectionResult?: {
    category?: string;
  };
  confidence?: number;
  reasoning?: string;
  [key: string]: any;
}

// Helper functions
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

function isPartialVin(vin: string): boolean {
  return typeof vin === "string" && vin.includes("*");
}

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

function shouldReplacePartialVin(existingVin: string, newVin: string): boolean {
  if (!existingVin || !newVin) return false;
  const existingIsPartial = isPartialVin(existingVin);
  const newIsComplete = !isPartialVin(newVin) && isMeaningfulValue(newVin);
  if (!existingIsPartial || !newIsComplete) return false;
  return vinMatches(existingVin, newVin);
}

function extractAvailableVehicleData(
  analysisResult: AnalysisResult,
  inspectionType?: string
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
  } catch (error) {
    logError(`Error updating inspection vehicle details`, error);
    throw error;
  }
}

async function updatePhotoWithAnalysis(
  supabase: any,
  photoId: string,
  category: string,
  llmAnalysis?: any
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
  } catch (error) {
    logError(`Error updating photo with analysis`, error);
    throw error;
  }
}

async function updateOBD2WithAnalysis(
  supabase: any,
  obd2Id: string,
  llmAnalysis?: any
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
  } catch (error) {
    logError(`Error updating OBD2 code with analysis`, error);
    throw error;
  }
}

async function updateTitleImageWithAnalysis(
  supabase: any,
  titleImageId: string,
  llmAnalysis?: any
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
  } catch (error) {
    logError(`Error updating title image with analysis`, error);
    throw error;
  }
}

// Main handler
Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    // Parse request body
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

    // Validate required fields
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

    // Get Supabase clients
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Prepare function-call payload
    const functionCallPayload = {
      function_name: "image_details_extraction",
      query: "Provide the results with the image url",
      inspection_id: inspection_id,
      user_id: user_id,
      files: [
        {
          type: "image",
          transfer_method: "remote_url",
          url: image_url,
        },
      ],
    };

    logDebug("Calling function-call service", {
      function_name: functionCallPayload.function_name,
      inspection_id,
    });

    // Call function-call edge function
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
      throw new Error(
        `Function-call failed: HTTP ${response.status}: ${errorText}`
      );
    }

    const data = await response.json();

    if (!data.success || !data.payload) {
      throw new Error(`Function call failed: ${JSON.stringify(data)}`);
    }

    logDebug("Function-call response received", {
      payload_length: data.payload.length,
    });

    // Parse the JSON response
    let jsonString = data.payload;

    // Look for JSON block between ```json and ``` markers
    const jsonMatch = jsonString.match(/```json\s*\n([\s\S]*?)\n\s*```/);
    if (jsonMatch) {
      jsonString = jsonMatch[1];
    } else {
      const jsonObjectMatch = jsonString.match(/\{[\s\S]*\}/);
      if (jsonObjectMatch) {
        jsonString = jsonObjectMatch[0];
      }
    }

    const answerJson: AnalysisResult = JSON.parse(jsonString.trim());

    // Extract vehicle details and update inspection if available
    if (answerJson.vehicle) {
      const vehicleDetails = extractAvailableVehicleData(
        answerJson,
        inspection_type
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

    // Create analysis without vehicle data for storage
    const analysisWithoutVehicle = { ...answerJson };
    delete analysisWithoutVehicle.vehicle;

    const category =
      answerJson.inspectionResult?.category ||
      answerJson.category ||
      "exterior";

    // Update the appropriate table based on image type
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

    const duration = Date.now() - startTime;

    logInfo("Image categorization completed successfully", {
      image_id,
      category,
      duration_ms: duration,
      has_vehicle_data: !!answerJson.vehicle,
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
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    const duration = Date.now() - startTime;
    logError("Image categorization failed", {
      error: (error as Error).message,
      stack: (error as Error).stack,
      duration_ms: duration,
    });

    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message || "Internal server error",
        duration_ms: duration,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
