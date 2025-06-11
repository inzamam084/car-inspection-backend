import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Base URL for the application
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") || "https://ourfixmate.vercel.app/";

// Function to send email notification (same as original)
async function sendReportEmail(email: string, inspectionId: string, reportId: string, vehicleInfo: any, summary: string) {
  try {
    const reportUrl = `${APP_BASE_URL}/report/${inspectionId}`;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    
    if (!resendApiKey) {
      console.error("RESEND_API_KEY is not set");
      return { success: false, error: "RESEND_API_KEY is not set" };
    }
    
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: 'Vehicle Inspection <mark@verta-sense.com>',
        to: email,
        subject: `Your Vehicle Inspection Report is Ready`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #f8f9fa; padding: 20px; text-align: center; border-bottom: 3px solid #4CAF50;">
            <h1 style="color: #333; margin: 0;">Your Vehicle Inspection Report</h1>
          </div>
          
          <div style="padding: 20px; background-color: white;">
            <p>Hello,</p>
            
            <p>Your vehicle inspection report for <strong>${vehicleInfo.vin}</strong> is now ready to view.</p>
            
            <div style="background-color: #f5f5f5; border-left: 4px solid #4CAF50; padding: 15px; margin: 20px 0;">
              <p style="margin: 0; font-style: italic;">"${summary}"</p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${reportUrl}" style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">View Full Report</a>
            </div>
            
            <p>This report includes:</p>
            <ul>
              <li>Detailed analysis of your vehicle's condition</li>
              <li>Identified issues and their severity</li>
              <li>Fair market value assessment</li>
              <li>Recommendations for next steps</li>
            </ul>
            
            <p>Your report will be available for 30 days. If you have any questions, please reply to this email.</p>
            
            <p>Thank you for using our service!</p>
          </div>
          
          <div style="padding: 20px; text-align: center; font-size: 12px; color: #666; background-color: #f8f9fa;">
            <p>© 2025 Vehicle Inspection Service. All rights reserved.</p>
            <p>This email was sent to you because you requested a vehicle inspection report.</p>
          </div>
        </div>
        `
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: "Unknown error" }));
      console.error("Error sending email:", errorData);
      return { success: false, error: errorData };
    }
    
    const data = await response.json();
    console.log("Email sent successfully:", data);
    return { success: true, data };
    
  } catch (error) {
    console.error("Unexpected error sending email:", error);
    return { success: false, error };
  }
}

// Add this function before the main serve function
async function calculateTotalCostsFromJobs(inspectionId: string) {
  const { data: jobs } = await supabase
    .from("processing_jobs")
    .select("cost, total_tokens, web_search_count, web_search_results")
    .eq("inspection_id", inspectionId)
    .eq("status", "completed");

  if (!jobs || jobs.length === 0) {
    return {
      totalCost: 0,
      totalTokens: 0,
      totalWebSearchCount: 0,
      allWebSearchResults: []
    };
  }

  const totalCost = jobs.reduce((sum, job) => sum + (job.cost || 0), 0);
  const totalTokens = jobs.reduce((sum, job) => sum + (job.total_tokens || 0), 0);
  const totalWebSearchCount = jobs.reduce((sum, job) => sum + (job.web_search_count || 0), 0);
  const allWebSearchResults = jobs.flatMap(job => job.web_search_results || []);

  return {
    totalCost,
    totalTokens,
    totalWebSearchCount,
    allWebSearchResults
  };
}


// Main serve function
serve(async (req) => {
  try {
    console.log("Generate-final-report function called");
    
    const payload = await req.json();
    const inspectionId = payload.inspection_id;
    
    console.log(`Generating final report for inspection ${inspectionId}`);
    
    // Update inspection status to finalizing
    await supabase
      .from("inspections")
      .update({ status: "finalizing" })
      .eq("id", inspectionId);
    
    // Get the final chunk result (last completed chunk analysis)
    const { data: finalChunkJob, error: finalChunkError } = await supabase
      .from("processing_jobs")
      .select("chunk_result, sequence_order")
      .eq("inspection_id", inspectionId)
      .eq("job_type", "chunk_analysis")
      .eq("status", "completed")
      .order("sequence_order", { ascending: false })
      .limit(1)
      .single();
    
    if (finalChunkError || !finalChunkJob || !finalChunkJob.chunk_result) {
      console.error("Error fetching final chunk result:", finalChunkError);
      await supabase.from("inspections").update({ status: "failed" }).eq("id", inspectionId);
      return new Response(JSON.stringify({ error: "No final chunk result found" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // Get the base analysis from the final chunk
    let parsedAnalysis = finalChunkJob.chunk_result;
    
    // Get all completed jobs for this inspection in sequence order
    const { data: allJobs } = await supabase
      .from("processing_jobs")
      .select("job_type, chunk_result, sequence_order")
      .eq("inspection_id", inspectionId)
      .eq("status", "completed")
      .order("sequence_order", { ascending: true });
    
    // Merge results from each agent
    if (allJobs) {
      for (const job of allJobs) {
        if (job.job_type === "ownership_cost_forecast" && job.chunk_result?.ownershipCostForecast) {
          parsedAnalysis.ownershipCostForecast = job.chunk_result.ownershipCostForecast;
        } else if (job.job_type === "fair_market_value" && job.chunk_result) {
          if (job.chunk_result.finalFairValueUSD) {
            parsedAnalysis.finalFairValueUSD = job.chunk_result.finalFairValueUSD;
          }
          if (job.chunk_result.priceAdjustment) {
            parsedAnalysis.priceAdjustment = job.chunk_result.priceAdjustment;
          }
        } else if (job.job_type === "expert_advice" && job.chunk_result?.advice) {
          parsedAnalysis.advice = job.chunk_result.advice;
        }
      }
    }
    
    // Get inspection details
    const { data: inspection, error: inspectionError } = await supabase
      .from("inspections")
      .select("id, vin, email")
      .eq("id", inspectionId)
      .single();
    
    if (inspectionError) {
      console.error("Error fetching inspection:", inspectionError);
      await supabase.from("inspections").update({ status: "failed" }).eq("id", inspectionId);
      return new Response(JSON.stringify({ error: "Failed to fetch inspection details" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // Calculate total costs from all jobs
    const costData = await calculateTotalCostsFromJobs(inspectionId);
    
    // Get chunk count for reporting
    const { data: allChunks } = await supabase
      .from("processing_jobs")
      .select("id")
      .eq("inspection_id", inspectionId)
      .eq("job_type", "chunk_analysis")
      .eq("status", "completed");
    
    // Extract overall summary from the final analysis
    const overallSummary = `Overall condition score: ${parsedAnalysis.overallConditionScore}/10. ${parsedAnalysis.overallComments || ""}`;
    
    // Create or update the report with the analysis results
    let reportId;
    const { data: existingReport, error: reportCheckError } = await supabase
      .from("reports")
      .select("id")
      .eq("inspection_id", inspectionId)
      .maybeSingle();

    
    if (existingReport) {
      reportId = existingReport.id;
      await supabase
        .from("reports")
        .update({
          summary_json: parsedAnalysis,
          summary: overallSummary,
          cost: costData.totalCost,
          total_tokens: costData.totalTokens,
          web_search_count: costData.totalWebSearchCount,
          web_search_results: costData.allWebSearchResults,
          ai_model: "gpt-4.1",
          updated_at: new Date().toISOString()
        })
        .eq("id", reportId);
    } else {
      const { data: newReport } = await supabase
        .from("reports")
        .insert({
          inspection_id: inspectionId,
          summary_json: parsedAnalysis,
          summary: overallSummary,
          cost: costData.totalCost,
          total_tokens: costData.totalTokens,
          ai_model: "gpt-4.1",
          web_search_count: costData.totalWebSearchCount,
          web_search_results: costData.allWebSearchResults
        })
        .select("id")
        .single();
      reportId = newReport?.id;
    }
    
    // Send email notification first
    const vehicleInfo = {
      vin: inspection.vin
    };
    
    const emailResult = await sendReportEmail(inspection.email, inspectionId, reportId, vehicleInfo, overallSummary);
    
    // Update inspection status to 'done' and mark email as sent
    await supabase
      .from("inspections")
      .update({ 
        status: "done",
        email_sent: emailResult.success 
      })
      .eq("id", inspectionId);
    
    console.log(`Successfully generated final report for inspection ${inspectionId}`);
    
    return new Response(JSON.stringify({
      success: true,
      message: "Final report generated successfully",
      inspectionId,
      reportId,
      totalChunks: allChunks?.length || 0,
      overallScore: parsedAnalysis.overallConditionScore
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
    
  } catch (error) {
    console.error("Unexpected error in generate-final-report:", error);
    return new Response(JSON.stringify({
      error: "Internal server error",
      message: error.message
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});
