import { supabase, appConfig } from "./config.ts";
import { JOB_TYPES, JOB_STATUS, INSPECTION_STATUS } from "./schemas.ts";
import { generatePdfReport, calculateTotalCostsFromJobs } from "./utils.ts";

export async function processFinalReport(inspectionId: string) {
  try {
    console.log(`Starting final report generation for inspection ${inspectionId}`);

    // Update inspection status to finalizing
    await supabase
      .from("inspections")
      .update({
        status: INSPECTION_STATUS.FINALIZING
      })
      .eq("id", inspectionId);

    // Get the final chunk result (last completed chunk analysis)
    const { data: finalChunkJob, error: finalChunkError } = await supabase
      .from("processing_jobs")
      .select("chunk_result, sequence_order")
      .eq("inspection_id", inspectionId)
      .eq("job_type", JOB_TYPES.CHUNK_ANALYSIS)
      .eq("status", JOB_STATUS.COMPLETED)
      .order("sequence_order", { ascending: false })
      .limit(1)
      .single();

    if (finalChunkError || !finalChunkJob || !finalChunkJob.chunk_result) {
      console.error("Error fetching final chunk result:", finalChunkError);
      await supabase
        .from("inspections")
        .update({
          status: INSPECTION_STATUS.FAILED
        })
        .eq("id", inspectionId);
      throw new Error("No final chunk result found");
    }

    // Get the base analysis from the final chunk
    let parsedAnalysis = finalChunkJob.chunk_result;

    // Get all completed jobs for this inspection in sequence order
    const { data: allJobs } = await supabase
      .from("processing_jobs")
      .select("job_type, chunk_result, sequence_order")
      .eq("inspection_id", inspectionId)
      .eq("status", JOB_STATUS.COMPLETED)
      .order("sequence_order", { ascending: true });

    // Merge results from each agent
    if (allJobs) {
      for (const job of allJobs) {
        if (job.job_type === JOB_TYPES.OWNERSHIP_COST_FORECAST && job.chunk_result?.ownershipCostForecast) {
          parsedAnalysis.ownershipCostForecast = job.chunk_result.ownershipCostForecast;
        } else if (job.job_type === JOB_TYPES.FAIR_MARKET_VALUE && job.chunk_result) {
          if (job.chunk_result.finalFairValueUSD) {
            parsedAnalysis.finalFairValueUSD = job.chunk_result.finalFairValueUSD;
            parsedAnalysis.finalFairAverageValueUSD = job.chunk_result.finalFairAverageValueUSD;
          }
          if (job.chunk_result.priceAdjustment) {
            parsedAnalysis.priceAdjustment = job.chunk_result.priceAdjustment;
          }
        } else if (job.job_type === JOB_TYPES.EXPERT_ADVICE && job.chunk_result?.advice) {
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
      await supabase
        .from("inspections")
        .update({
          status: INSPECTION_STATUS.FAILED
        })
        .eq("id", inspectionId);
      throw new Error("Failed to fetch inspection details");
    }

    // Calculate total costs from all jobs
    const costData = await calculateTotalCostsFromJobs(inspectionId);

    // Get chunk count for reporting
    const { data: allChunks } = await supabase
      .from("processing_jobs")
      .select("id")
      .eq("inspection_id", inspectionId)
      .eq("job_type", JOB_TYPES.CHUNK_ANALYSIS)
      .eq("status", JOB_STATUS.COMPLETED);

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
          ai_model: appConfig.aiModel,
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
          ai_model: appConfig.aiModel,
          web_search_count: costData.totalWebSearchCount,
          web_search_results: costData.allWebSearchResults
        })
        .select("id")
        .single();
      reportId = newReport?.id;
    }

    // Generate PDF report
    const pdfResult = await generatePdfReport(inspectionId);

    // Update inspection status to 'done' and mark email as sent
    await supabase
      .from("inspections")
      .update({
        status: INSPECTION_STATUS.DONE,
        email_sent: pdfResult.success
      })
      .eq("id", inspectionId);

    console.log(`Successfully generated final report for inspection ${inspectionId}`);

    return {
      success: true,
      message: "Final report generated successfully",
      inspectionId,
      reportId,
      totalChunks: allChunks?.length || 0,
      overallScore: parsedAnalysis.overallConditionScore
    };

  } catch (error) {
    console.error(`Error processing final report for inspection ${inspectionId}:`, error);

    // Update inspection status to failed
    await supabase
      .from("inspections")
      .update({
        status: INSPECTION_STATUS.FAILED
      })
      .eq("id", inspectionId);

    throw error;
  }
}
