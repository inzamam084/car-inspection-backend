import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { supabase } from "./config.ts";
import { processFairMarketValue } from "./fair-market-value-processor.ts";

// Main serve function
serve(async (req) => {
  try {
    console.log("Fair market value researcher request received");

    // Parse the request payload
    const payload = await req.json();
    const { inspection_id: inspectionId } = payload;

    console.log(`Starting fair market value analysis for inspection ${inspectionId}`);

    // Find the fair market value job for this inspection
    const { data: job, error: jobError } = await supabase
      .from("processing_jobs")
      .select("*")
      .eq("inspection_id", inspectionId)
      .eq("job_type", "fair_market_value")
      .eq("status", "processing")
      .single();

    if (jobError || !job) {
      console.error("Error fetching fair market value job:", jobError);
      return new Response(JSON.stringify({
        error: "No processing fair market value job found"
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
      EdgeRuntime.waitUntil(processFairMarketValue(job.id, inspectionId));
    } else {
      // Fallback for environments without EdgeRuntime.waitUntil
      processFairMarketValue(job.id, inspectionId).catch((error) => {
        console.error(`Background fair market value processing failed for job ${job.id}:`, error);
      });
    }

    // Return immediate response
    return new Response(JSON.stringify({
      success: true,
      message: "Fair market value analysis started in background",
      jobId: job.id
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    });

  } catch (error) {
    console.error("Unexpected error in fair-market-value-researcher:", error);
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
