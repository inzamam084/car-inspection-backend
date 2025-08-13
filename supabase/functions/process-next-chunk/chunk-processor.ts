/**
 * Main processing logic for the process-next-chunk function
 */

import { DIFY_CONFIG } from "./config.ts";
import { PROMPT_MASTER } from "./prompts.ts";
import { VEHICLE_REPORT_SCHEMA } from "./vehicle-report-schema.ts";
import {
  getInspectionData,
  combineAllImages,
  createVehicleInformation,
  batchUploadSupabaseImagesRest,
  buildGeminiRequestBodyRest,
  updateInspectionWorkflowId,
} from "./utils.ts";
import type {
  FileReference,
  VehicleInformation,
  DifyWorkflowPayload,
  DifyStreamEvent,
  ProcessingError,
} from "./schemas.ts";

// Declare EdgeRuntime for type safety
declare const EdgeRuntime: any;

/**
 * Send data to Dify Workflow API with streaming response handling
 */
export async function sendToDifyAPI(
  inspectionId: string,
  uploadedFiles: FileReference[],
  vehicleInformation: VehicleInformation,
  geminiRequestBody: any
): Promise<void> {
  try {
    // Prepare inputs for Dify workflow
    const difyPayload: DifyWorkflowPayload = {
      inputs: {
        inspection_id: inspectionId,
        gemini_request_body: JSON.stringify(geminiRequestBody),
      },
      response_mode: "streaming",
      user: `inspection_${inspectionId}`,
    };

    console.log("Sending data to Dify Workflow API:", {
      inspection_id: inspectionId,
      uploaded_files_count: uploadedFiles.length,
      vehicle_information: vehicleInformation,
    });

    const difyResponse = await fetch(DIFY_CONFIG.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DIFY_CONFIG.apiKey}`,
      },
      body: JSON.stringify(difyPayload),
    });

    if (!difyResponse.ok) {
      const errorText = await difyResponse.text();
      throw new Error(
        `Dify Workflow API request failed: ${difyResponse.status} ${difyResponse.statusText} - ${errorText}`
      );
    }

    // Handle streaming response
    await handleDifyStreamingResponse(difyResponse, inspectionId);

    console.log(
      `Successfully initiated Dify workflow for inspection ${inspectionId}`
    );
  } catch (error) {
    console.error(
      `Error sending data to Dify Workflow API for inspection ${inspectionId}:`,
      error
    );
    throw error;
  }
}

/**
 * Handle Dify streaming response
 */
async function handleDifyStreamingResponse(
  response: Response,
  inspectionId: string
): Promise<void> {
  if (!response.body) {
    throw new Error("No response body received from Dify API");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Accumulate chunks in buffer to handle partial JSON
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");

      // Keep the last incomplete line in buffer
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          await processDifyStreamLine(line, inspectionId);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Process individual Dify stream line
 */
async function processDifyStreamLine(
  line: string,
  inspectionId: string
): Promise<void> {
  try {
    const jsonStr = line.slice(6).trim();
    if (!jsonStr) return;

    const data: DifyStreamEvent = JSON.parse(jsonStr);

    // Handle different event types with detailed logging
    switch (data.event) {
      case "workflow_started":
        console.log(`🚀 [WORKFLOW_STARTED] Inspection ${inspectionId}:`, {
          workflow_run_id: data.workflow_run_id,
          task_id: data.task_id,
          workflow_id: data.data?.workflow_id,
          created_at: data.data?.created_at,
        });
        break;

      case "node_started":
        console.log(`🔄 [NODE_STARTED] Inspection ${inspectionId}:`, {
          workflow_run_id: data.workflow_run_id,
          task_id: data.task_id,
          node_id: data.data?.node_id,
          node_type: data.data?.node_type,
          title: data.data?.title,
          index: data.data?.index,
          predecessor_node_id: data.data?.predecessor_node_id,
          created_at: data.data?.created_at,
        });
        break;

      case "text_chunk":
        console.log(`📝 [TEXT_CHUNK] Inspection ${inspectionId}:`, {
          workflow_run_id: data.workflow_run_id,
          task_id: data.task_id,
          text:
            data.data?.text?.substring(0, 100) +
            (data.data?.text?.length > 100 ? "..." : ""),
          from_variable_selector: data.data?.from_variable_selector,
        });
        break;

      case "node_finished":
        console.log(`✅ [NODE_FINISHED] Inspection ${inspectionId}:`, {
          workflow_run_id: data.workflow_run_id,
          task_id: data.task_id,
          node_id: data.data?.node_id,
          node_type: data.data?.node_type,
          title: data.data?.title,
          index: data.data?.index,
          status: data.data?.status,
          elapsed_time: data.data?.elapsed_time,
          total_tokens: data.data?.execution_metadata?.total_tokens,
          total_price: data.data?.execution_metadata?.total_price,
          currency: data.data?.execution_metadata?.currency,
          error: data.data?.error,
        });
        break;

      case "workflow_finished":
        console.log(`🏁 [WORKFLOW_FINISHED] Inspection ${inspectionId}:`, {
          workflow_run_id: data.workflow_run_id,
          task_id: data.task_id,
          workflow_id: data.data?.workflow_id,
          status: data.data?.status,
          elapsed_time: data.data?.elapsed_time,
          total_tokens: data.data?.total_tokens,
          total_steps: data.data?.total_steps,
          outputs: data.data?.outputs,
          error: data.data?.error,
          created_at: data.data?.created_at,
          finished_at: data.data?.finished_at,
        });

        // Update inspection record with workflow completion
        if (data.workflow_run_id) {
          await updateInspectionWorkflowId(inspectionId, data.workflow_run_id);
        }
        break;

      case "tts_message":
        console.log(`🔊 [TTS_MESSAGE] Inspection ${inspectionId}:`, {
          workflow_run_id: data.workflow_run_id,
          task_id: data.task_id,
          message_id: data.message_id,
          audio_length: data.audio?.length || 0,
          created_at: data.created_at,
        });
        break;

      case "tts_message_end":
        console.log(`🔇 [TTS_MESSAGE_END] Inspection ${inspectionId}:`, {
          workflow_run_id: data.workflow_run_id,
          task_id: data.task_id,
          message_id: data.message_id,
          created_at: data.created_at,
        });
        break;

      case "ping":
        console.log(
          `💓 [PING] Inspection ${inspectionId}: Connection keepalive`
        );
        break;

      default:
        console.log(`❓ [UNKNOWN_EVENT] Inspection ${inspectionId}:`, {
          event: data.event,
          workflow_run_id: data.workflow_run_id,
          task_id: data.task_id,
          data: data.data,
        });
        break;
    }
  } catch (parseError) {
    console.warn(
      `⚠️ Failed to parse streaming data for inspection ${inspectionId}:`,
      {
        error: parseError.message,
        line: line.substring(0, 200) + (line.length > 200 ? "..." : ""),
      }
    );
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
