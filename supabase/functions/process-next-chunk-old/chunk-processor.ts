/**
 * Main processing logic for the process-next-chunk function
 */

import { PROMPT_MASTER } from "./prompts.ts";
import { VEHICLE_REPORT_SCHEMA } from "./vehicle-report-schema.ts";
import {
  getInspectionData,
  combineAllImages,
  createVehicleInformation,
  batchUploadSupabaseImagesRest,
  buildGeminiRequestBodyRest,
  updateInspectionWorkflowId,
  validateGeminiApiKey,
} from "./utils.ts";
import type {
  FileReference,
  VehicleInformation,
  DifyStreamEvent,
  ProcessingError,
} from "./schemas.ts";

// Declare EdgeRuntime and Deno for type safety
declare const EdgeRuntime: any;
declare const Deno: any;

/**
 * Send data to Dify Workflow API via function-call service with streaming response handling
 */
export async function sendToDifyAPI(
  inspectionId: string,
  uploadedFiles: FileReference[],
  vehicleInformation: VehicleInformation,
  geminiRequestBody: any
): Promise<void> {
  try {
    // Prepare payload for function-call service
    const functionCallPayload = {
      function_name: "car_inspection_workflow_old", // This should match the function name in dify_function_mapping table
      response_mode: "streaming",
      // user_id: `inspection_${inspectionId}`,
      inspection_id: inspectionId,
      gemini_request_body: JSON.stringify(geminiRequestBody),
      uploaded_files_count: uploadedFiles.length,
      vehicle_information: vehicleInformation,
    };

    console.log("Sending data to function-call service:", {
      inspection_id: inspectionId,
      uploaded_files_count: uploadedFiles.length,
      vehicle_information: vehicleInformation,
    });

    // Get the function-call service URL (assuming it's deployed as a Supabase Edge Function)
    const functionCallUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/function-call`;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

    // Fire-and-forget request to function-call service
    // We don't await the streaming response since it will run in background
    fetch(functionCallUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify(functionCallPayload),
    }).then(async (functionCallResponse) => {
      if (!functionCallResponse.ok) {
        const errorText = await functionCallResponse.text();
        console.error(
          `Function-call service request failed: ${functionCallResponse.status} ${functionCallResponse.statusText} - ${errorText}`
        );
        return;
      }
      
      console.log(
        `Successfully initiated Dify workflow via function-call service for inspection ${inspectionId}`
      );
      
      // The streaming response will be handled entirely by the function-call service
      // We don't need to process the stream here since it's fire-and-forget
    }).catch((error) => {
      console.error(
        `Error sending data to function-call service for inspection ${inspectionId}:`,
        error
      );
    });

    console.log(
      `Dify workflow request sent to function-call service for inspection ${inspectionId}`
    );
  } catch (error) {
    console.error(
      `Error sending data to function-call service for inspection ${inspectionId}:`,
      error
    );
    throw error;
  }
}


/**
 * Main Gemini processing function (replaces chunk processing)
 */
export async function processGeminiAnalysisRest(
  inspectionId: string
): Promise<void> {
  let uploadedFiles: FileReference[] = [];

  try {
    console.log(`Starting Gemini analysis for inspection ${inspectionId}`);

    // Validate Gemini API key first
    const isApiKeyValid = await validateGeminiApiKey();
    if (!isApiKeyValid) {
      throw new Error("Gemini API key validation failed. Please check your GEMINI_API_KEY environment variable.");
    }

    // Get inspection data from database
    const inspectionData = await getInspectionData(inspectionId);
    console.log("INSPECTION DATA:", inspectionData);

    // Combine all images from different sources
    const allImages = combineAllImages(inspectionData);
    console.log(
      `Processing ${allImages.length} images for inspection ${inspectionId}`
    );

    // Upload all images to Gemini Files API
    uploadedFiles = await batchUploadSupabaseImagesRest(allImages, 3);
    console.log("UPLOADED FILES:", uploadedFiles);

    if (uploadedFiles.length === 0) {
      throw new Error("No images were successfully uploaded to Gemini");
    }

    console.log(
      `Successfully uploaded ${uploadedFiles.length}/${allImages.length} images to Gemini`
    );

    // Create vehicle information object
    const vehicleInformation = createVehicleInformation(inspectionData);

    // Build Gemini request body
    const geminiRequestBody = buildGeminiRequestBodyRest(
      PROMPT_MASTER,
      vehicleInformation,
      inspectionData.obd2_codes,
      uploadedFiles,
      VEHICLE_REPORT_SCHEMA
    );

    // Send to Dify API in background
    EdgeRuntime.waitUntil(
      sendToDifyAPI(
        inspectionId,
        uploadedFiles,
        vehicleInformation,
        geminiRequestBody
      )
    );

    console.log(
      `Successfully completed Gemini analysis and started Dify workflow for inspection ${inspectionId}`
    );
  } catch (error) {
    const processingError: ProcessingError = new Error(
      `Failed to process Gemini analysis: ${error.message}`
    );
    processingError.inspectionId = inspectionId;
    processingError.stage = "gemini_analysis";

    console.error(
      `Error processing Gemini analysis for inspection ${inspectionId}:`,
      error
    );
    throw processingError;
  }
  // Note: File cleanup is commented out in original code
  // We may want to implement cleanup later if needed
}
