/**
 * Utility functions for the process-next-chunk function
 */

import {
  supabase,
  GEMINI_CONFIG,
} from "./config.ts";
import type {
  FileReference,
  GeminiContentPart,
  GeminiRequestBody,
  OBD2CodeData,
  VehicleInformation,
} from "./schemas.ts";

/**
 * Build content structure for Gemini API using LLM analysis data
 */
export function buildGeminiContentWithAnalysis(
  systemPrompt: string,
  dataBlock: VehicleInformation,
  obd2Codes: OBD2CodeData[],
  inspectionData: any
): { parts: GeminiContentPart[] } {
  const parts: GeminiContentPart[] = [];

  // Add system prompt
  // parts.push({ text: systemPrompt });

  // Add data block
  if (dataBlock) {
    parts.push({
      text: `DATA_BLOCK: ${JSON.stringify(dataBlock)}`,
    });
  }

  // Add OBD2 codes
  for (const code of obd2Codes) {
    if (code.code) {
      parts.push({
        text: `Code: ${code.code}\nDescription: ${code.description || ""}`,
      });
    }
  }

  // Add LLM analysis data from photos instead of actual images
  if (inspectionData.photos && inspectionData.photos.length > 0) {
    parts.push({
      text: "IMAGE_ANALYSIS_DATA:",
    });
    
    for (const photo of inspectionData.photos) {
      if (photo.llm_analysis) {
        parts.push({
          text: `Category: ${photo.category}\nAnalysis: ${JSON.stringify(photo.llm_analysis)}`,
        });
      }
    }
  }

  // Add title images analysis if available
  if (inspectionData.title_images && inspectionData.title_images.length > 0) {
    for (const titleImage of inspectionData.title_images) {
      if (titleImage.llm_analysis) {
        parts.push({
          text: `Category: title\nAnalysis: ${JSON.stringify(titleImage.llm_analysis)}`,
        });
      }
    }
  }

  return { parts };
}

/**
 * Build content structure for Gemini API (legacy function for backward compatibility)
 */
export function buildGeminiContentRest(
  systemPrompt: string,
  dataBlock: VehicleInformation,
  obd2Codes: OBD2CodeData[],
  uploadedFiles: FileReference[]
): { parts: GeminiContentPart[] } {
  const parts: GeminiContentPart[] = [];

  // Add system prompt
  parts.push({ text: systemPrompt });

  // Add data block
  if (dataBlock) {
    parts.push({
      text: `DATA_BLOCK: ${JSON.stringify(dataBlock)}`,
    });
  }

  // Add OBD2 codes
  for (const code of obd2Codes) {
    if (code.code) {
      parts.push({
        text: `Code: ${code.code}\nDescription: ${code.description || ""}`,
      });
    }
  }

  // Add file references grouped by category
  for (const file of uploadedFiles) {
    parts.push({
      text: `Category: ${file.category}`,
    });
    parts.push({
      file_data: {
        mime_type: file.mimeType,
        file_uri: file.uri,
      },
    });
  }

  return { parts };
}

/**
 * Build complete Gemini request body with schema using LLM analysis data
 */
export function buildGeminiRequestBodyRest(
  systemPrompt: string,
  dataBlock: VehicleInformation,
  obd2Codes: OBD2CodeData[],
  schema: any,
  inspectionData?: any
): GeminiRequestBody {
  let contents;
  
  if (inspectionData) {
    // Use LLM analysis data instead of uploaded files
    contents = buildGeminiContentWithAnalysis(
      systemPrompt,
      dataBlock,
      obd2Codes,
      inspectionData
    );
  } else {
    // Fallback to empty content if no inspection data
    contents = {
      parts: [
        { text: systemPrompt },
        { text: `DATA_BLOCK: ${JSON.stringify(dataBlock)}` }
      ]
    };
  }

  // Return complete request body
  return {
    contents: [contents],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
      temperature: 0.1,
    },
  };
}

/**
 * Build complete Gemini request body with schema (legacy version with uploaded files)
 */
export function buildGeminiRequestBodyRestLegacy(
  systemPrompt: string,
  dataBlock: VehicleInformation,
  obd2Codes: OBD2CodeData[],
  uploadedFiles: FileReference[],
  schema: any
): GeminiRequestBody {
  // Build content parts
  const contents = buildGeminiContentRest(
    systemPrompt,
    dataBlock,
    obd2Codes,
    uploadedFiles
  );

  // Return complete request body
  return {
    contents: [contents],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
      temperature: 0.1,
    },
  };
}

/**
 * Validate Gemini API key by making a simple API call
 */
export async function validateGeminiApiKey(): Promise<boolean> {
  try {
    if (!GEMINI_CONFIG.apiKey) {
      console.error("❌ GEMINI_API_KEY environment variable is not set");
      return false;
    }

    // Test API key with a simple models list request
    const testResponse = await fetch(
      `${GEMINI_CONFIG.baseUrl}/v1beta/models`,
      {
        method: "GET",
        headers: {
          "x-goog-api-key": GEMINI_CONFIG.apiKey,
        },
      }
    );

    if (!testResponse.ok) {
      const errorText = await testResponse.text();
      console.error(`❌ Gemini API key validation failed: ${testResponse.status} ${testResponse.statusText} - ${errorText}`);
      return false;
    }

    console.log("✅ Gemini API key is valid");
    return true;
  } catch (error) {
    console.error("❌ Error validating Gemini API key:", error);
    return false;
  }
}


/**
 * Get inspection data from database including llm_analysis
 */
export async function getInspectionData(inspectionId: string) {
  const { data: inspectionData, error: inspectionError } = await supabase
    .from("inspections")
    .select(
      `
      id, vin, mileage, zip,
      photos(*, llm_analysis),
      obd2_codes:obd2_codes(*),
      title_images:title_images(*)
    `
    )
    .eq("id", inspectionId)
    .single();

  if (inspectionError || !inspectionData) {
    throw new Error(
      `Failed to fetch inspection data: ${inspectionError?.message}`
    );
  }

  return inspectionData;
}


/**
 * Create vehicle information object
 */
export function createVehicleInformation(
  inspectionData: any
): VehicleInformation {
  return {
    vin: inspectionData.vin,
    mileage: inspectionData.mileage,
    zip: inspectionData.zip,
    vinHistory: null,
    marketPriceBands: null,
  };
}

/**
 * Update inspection with workflow run ID
 */
export async function updateInspectionWorkflowId(
  inspectionId: string,
  workflowRunId: string
): Promise<void> {
  const { error: updateError } = await supabase
    .from("inspections")
    .update({
      workflow_run_id: workflowRunId,
    })
    .eq("id", inspectionId);

  if (updateError) {
    console.warn("❌ Failed to update inspection record:", updateError);
    throw new Error(`Failed to update inspection: ${updateError.message}`);
  }

  console.log(`✅ Updated inspection ${inspectionId} with workflow completion`);
}

/**
 * Sleep utility for rate limiting
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
