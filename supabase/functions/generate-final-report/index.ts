import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { processFinalReport } from "./final-report-processor.ts";

// Main serve function
serve(async (req) => {
  try {
    console.log("Generate-final-report function called");

    // Parse the request payload
    const payload = await req.json();
    const inspectionId = payload.inspection_id;

    console.log(`Generating final report for inspection ${inspectionId}`);

    // Start background processing using EdgeRuntime.waitUntil
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      EdgeRuntime.waitUntil(processFinalReport(inspectionId));
    } else {
      // Fallback for environments without EdgeRuntime.waitUntil
      processFinalReport(inspectionId).catch((error) => {
        console.error(`Background final report processing failed for inspection ${inspectionId}:`, error);
      });
    }

    // Return immediate response
    return new Response(JSON.stringify({
      success: true,
      message: "Final report generation started in background",
      inspectionId
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    });

  } catch (error) {
    console.error("Unexpected error in generate-final-report:", error);
    return new Response(JSON.stringify({
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error"
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
});
