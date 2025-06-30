import { supabase, geminiConfig } from "./config.ts";
import { EXPERT_ADVICE_PROMPT } from "./schemas.ts";
import {
  calculateCost,
  extractSearchResults,
  parseResponse,
  buildVehicleSearchTerms,
  extractIssues
} from "./utils.ts";

export async function processExpertAdvice(jobId: string, inspectionId: string) {
  try {
    console.log(`Starting expert advice analysis for job ${jobId}`);

    // Get the job details
    const { data: job, error: jobError } = await supabase
      .from("processing_jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (jobError || !job) {
      console.error("Error fetching job:", jobError);
      return;
    }

    // Get the final chunk analysis result
    const { data: finalChunkJob, error: finalChunkError } = await supabase
      .from("processing_jobs")
      .select("chunk_result")
      .eq("inspection_id", inspectionId)
      .eq("job_type", "chunk_analysis")
      .eq("status", "completed")
      .order("sequence_order", { ascending: false })
      .limit(1)
      .single();

    if (finalChunkError || !finalChunkJob || !finalChunkJob.chunk_result) {
      throw new Error("No final chunk result found for expert advice analysis");
    }

    const inspectionResults = finalChunkJob.chunk_result;

    // Get inspection details
    const { data: inspection } = await supabase
      .from("inspections")
      .select("vin, mileage, zip")
      .eq("id", inspectionId)
      .single();

    // Extract vehicle information
    const vehicle = inspectionResults.vehicle || {};
    const year = vehicle.Year;
    const make = vehicle.Make;
    const model = vehicle.Model;
    const mileage = vehicle.Mileage || inspection?.mileage;
    const location = inspection?.zip || vehicle.Location;

    // Build search terms and extract key issues
    const searchTerms = buildVehicleSearchTerms(year, make, model);
    const keyIssues = extractIssues(inspectionResults);

    // Build analysis prompt with complete inspection data
    const analysisPrompt = `${EXPERT_ADVICE_PROMPT}

**COMPLETE INSPECTION RESULTS**:
${JSON.stringify(inspectionResults, null, 2)}

**SEARCH TERMS TO USE**:
${searchTerms.map((term, index) => `${index + 1}. "${term}"`).join('\n')}

Perform the web searches and analyze the results to provide expert advice that combines web research with actual inspection findings.`;

    // Call Gemini API with web search
    const response = await fetch(geminiConfig.endpoint, {
      method: "POST",
      headers: geminiConfig.headers,
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: analysisPrompt
          }]
        }],
        tools: [{
          google_search: {}
        }],
        generationConfig: {
          temperature: 0.1,
          topK: 40,
          topP: 0.95,
          responseMimeType: "application/json"
        }
      })
    });

    console.log("Response : ", response);

    // Parse response
    const expertAdviceAnalysis = parseResponse(await response.json());
    console.log("Expert Advice Analysis : ", expertAdviceAnalysis);

    if (expertAdviceAnalysis.error) {
      throw new Error(`Expert advice analysis parsing failed: ${expertAdviceAnalysis.error}`);
    }

    // Calculate cost and extract web search results
    const cost = calculateCost(response);
    const searchResults = extractSearchResults(response);

    // Ensure web_search_results are included in the analysis result
    if (!expertAdviceAnalysis.web_search_results) {
      expertAdviceAnalysis.web_search_results = searchResults.webSearchResults;
    }

    if (Array.isArray(expertAdviceAnalysis.web_search_results)) {
      searchResults.webSearchCount = expertAdviceAnalysis.web_search_results.length;
    }

    // Update job with results
    const updateResult = await supabase
      .from("processing_jobs")
      .update({
        status: "completed",
        chunk_result: expertAdviceAnalysis,
        cost: cost.totalCost,
        total_tokens: cost.totalTokens,
        web_search_count: searchResults.webSearchCount,
        web_search_results: expertAdviceAnalysis.web_search_results,
        completed_at: new Date().toISOString()
      })
      .eq("id", job.id);

    if (updateResult.error) {
      console.error("Error updating expert advice job:", updateResult.error);
      throw new Error(`Failed to update job: ${updateResult.error.message}`);
    }

    console.log(`Successfully completed expert advice analysis for job ${job.id}`);

  } catch (error) {
    console.error(`Error processing expert advice job ${jobId}:`, error);

    // Update job status to failed
    await supabase
      .from("processing_jobs")
      .update({
        status: "failed",
        error_message: error.message,
        completed_at: new Date().toISOString()
      })
      .eq("id", jobId);
  }
}
