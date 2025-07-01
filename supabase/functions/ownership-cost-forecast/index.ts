import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { supabase } from "./config.ts";
import { processOwnershipCostForecast } from "./ownership-cost-forecast-processor.ts";

// Main serve function
serve(async (req) => {
  try {
    console.log("Ownership cost forecast researcher request received");

    // Parse the request payload
    const payload = await req.json();
    const { inspection_id: inspectionId } = payload;

    console.log(`Starting ownership cost forecast analysis for inspection ${inspectionId}`);

    // Find the ownership cost forecast job for this inspection
    const { data: job, error: jobError } = await supabase
      .from("processing_jobs")
      .select("*")
      .eq("inspection_id", inspectionId)
      .eq("job_type", "ownership_cost_forecast")
      .eq("status", "processing")
      .single();

    if (jobError || !job) {
      console.error("Error fetching ownership cost forecast job:", jobError);
      return new Response(JSON.stringify({
        error: "No processing ownership cost forecast job found"
      }), {
        status: 404,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }

    // Job is already set to processing by process-next-chunk
    // No need to update status again

    // Start background processing using EdgeRuntime.waitUntil
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      EdgeRuntime.waitUntil(processOwnershipCostForecast(job.id, inspectionId));
    } else {
      // Fallback for environments without EdgeRuntime.waitUntil
      processOwnershipCostForecast(job.id, inspectionId).catch((error) => {
        console.error(`Background ownership cost forecast processing failed for job ${job.id}:`, error);
      });
    }

    // Return immediate response
    return new Response(JSON.stringify({
      success: true,
      message: "Ownership cost forecast analysis started in background",
      jobId: job.id
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    });

  } catch (error) {
    console.error("Unexpected error in ownership-cost-forecast:", error);
    return new Response(JSON.stringify({
      error: "Internal server error"
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
});
