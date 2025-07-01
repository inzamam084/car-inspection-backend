import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { supabase } from "./config.ts";
import { processExpertAdvice } from "./expert-advice-processor.ts";

declare const EdgeRuntime: any;

// Main serve function
serve(async (req) => {
  try {
    console.log("Expert advice researcher request received");
    // Parse the request payload
    const payload = await req.json();
    const { inspection_id: inspectionId } = payload;
    console.log(`Starting expert advice analysis for inspection ${inspectionId}`);
    // Find the expert advice job for this inspection
    const { data: job, error: jobError } = await supabase.from("processing_jobs").select("*").eq("inspection_id", inspectionId).eq("job_type", "expert_advice").eq("status", "processing").single();
    if (jobError || !job) {
      console.error("Error fetching expert advice job:", jobError);
      return new Response(JSON.stringify({
        error: "No processing expert advice job found"
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
      EdgeRuntime.waitUntil(processExpertAdvice(job.id, inspectionId));
    } else {
      // Fallback for environments without EdgeRuntime.waitUntil
      processExpertAdvice(job.id, inspectionId).catch((error) => {
        console.error(`Background expert advice processing failed for job ${job.id}:`, error);
      });
    }
    // Return immediate response
    return new Response(JSON.stringify({
      success: true,
      message: "Expert advice analysis started in background",
      jobId: job.id
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Unexpected error in expert-advice-researcher:", error);
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
