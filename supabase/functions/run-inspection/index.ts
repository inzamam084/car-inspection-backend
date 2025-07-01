import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { supabase } from "./config.ts";
import { runAnalysisInBackground, runScrapeThenAnalysis } from "./run-inspection-processor.ts";
import type { WebhookPayload, ApiResponse, ErrorResponse, Inspection } from "./schemas.ts";

// Declare EdgeRuntime for type safety
declare const EdgeRuntime: any;

// Main serve function
serve(async (req): Promise<Response> => {
  try {
    console.log("Request received..");

    // Parse the webhook payload
    const payload: WebhookPayload = await req.json();
    console.log("Received webhook payload:", JSON.stringify(payload));

    const inspectionId = payload.inspection_id;
    console.log(`Processing analysis for inspection ${inspectionId}`);

    // Basic validation - just check if inspection exists
    const { data: inspection, error: inspectionError } = await supabase
      .from("inspections")
      .select("id, vin, email, type, url")
      .eq("id", inspectionId)
      .single();

    if (inspectionError) {
      console.error("Error fetching inspection:", inspectionError);
      const errorResponse: ErrorResponse = {
        error: "Failed to fetch inspection details"
      };
      return new Response(JSON.stringify(errorResponse), {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }

    // Decide which pipeline to invoke
    const backgroundTask = inspection.type === 'url' 
      ? () => runScrapeThenAnalysis(inspection as Inspection)
      : () => runAnalysisInBackground(inspection.id);

    // Kick off in background
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      EdgeRuntime.waitUntil(backgroundTask());
    } else {
      backgroundTask().catch((err) => console.error(err));
    }

    // Return immediate response
    const response: ApiResponse = {
      success: true,
      message: "Analysis started in background",
      inspectionId,
      status: "processing"
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    });

  } catch (error) {
    console.error("Unexpected error:", error);
    const errorResponse: ErrorResponse = {
      error: "Internal server error"
    };
    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
});
