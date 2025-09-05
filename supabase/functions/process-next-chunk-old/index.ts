/**
 * Process Next Chunk Function - Refactored and Modularized
 * 
 * This function handles the processing of inspection data by:
 * 1. Fetching inspection data from the database
 * 2. Uploading images to Gemini Files API
 * 3. Building structured requests for AI analysis
 * 4. Initiating Dify workflow processing
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { processGeminiAnalysisRest } from "./chunk-processor.ts";
import type { 
  ProcessNextChunkPayload, 
  ProcessNextChunkResponse 
} from "./schemas.ts";

// Declare EdgeRuntime for type safety
declare const EdgeRuntime: any;

/**
 * Main serve function - Entry point for the Edge Function
 */
serve(async (req: Request): Promise<Response> => {
  try {
    console.log("Process next chunk request received");

    // Parse the request payload
    const payload: ProcessNextChunkPayload = await req.json();
    const {
      inspection_id: inspectionId,
      completed_sequence: completedSequence,
    } = payload;

    // Validate required parameters
    if (!inspectionId) {
      console.error("Missing inspection_id in payload");
      return new Response(
        JSON.stringify({
          error: "inspection_id is required in request payload",
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }

    console.log(`Processing inspection ${inspectionId}`, {
      completedSequence,
    });

    // Start background processing for Gemini analysis
    EdgeRuntime.waitUntil(processGeminiAnalysisRest(inspectionId));

    // Return success response immediately
    const response: ProcessNextChunkResponse = {
      message: "Processing started for inspection",
      inspectionId: inspectionId,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("Unexpected error in process-next-chunk:", error);

    // Return error response
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        message: error.message || "Unknown error occurred",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }
});
