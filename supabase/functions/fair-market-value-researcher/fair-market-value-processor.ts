import { supabase, openai } from "./config.ts";
import { FAIR_MARKET_VALUE_PROMPT, FAIR_MARKET_VALUE_SCHEMA } from "./schemas.ts";
import {
  calculateCost,
  extractSearchResults,
  parseResponse,
  buildVehicleSearchTerms,
  getExternalValuation
} from "./utils.ts";

// Background processing function
export async function processFairMarketValue(jobId: string, inspectionId: string) {
  try {
    console.log(`Starting fair market value analysis for job ${jobId}`);

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

    // Get the previous job result (ownership cost forecast)
    const { data: previousJob, error: previousJobError } = await supabase
      .from("processing_jobs")
      .select("chunk_result")
      .eq("inspection_id", inspectionId)
      .eq("sequence_order", job.sequence_order - 1)
      .eq("status", "completed")
      .single();

    if (previousJobError || !previousJob || !previousJob.chunk_result) {
      throw new Error("No previous job result found for fair market value analysis");
    }

    const inspectionResults = previousJob.chunk_result;
    console.log("inspections Results : ", inspectionResults);
    console.log("Inspection Vehicle : ", inspectionResults.vehicle);

    // Get the final chunk analysis result
    const { data: finalChunkJob } = await supabase
      .from("processing_jobs")
      .select("chunk_result")
      .eq("inspection_id", inspectionId)
      .eq("job_type", "chunk_analysis")
      .eq("status", "completed")
      .order("sequence_order", { ascending: false })
      .limit(1)
      .single();

    const inspection_results = finalChunkJob.chunk_result;

    // Get inspection details
    const { data: inspection } = await supabase
      .from("inspections")
      .select("vin, mileage, zip")
      .eq("id", inspectionId)
      .single();

    // Extract vehicle information
    const vehicle = inspection_results.vehicle || {};
    const year = vehicle.Year;
    const make = vehicle.Make;
    const model = vehicle.Model;
    const mileage = vehicle.Mileage || inspection?.mileage;
    const location = inspection?.zip || vehicle.Location;

    // Build search terms
    const searchTerms = buildVehicleSearchTerms(year, make, model, mileage, location);
    console.log(searchTerms);

    // Build analysis prompt with complete inspection data
    const analysisPrompt = `${FAIR_MARKET_VALUE_PROMPT}

**COMPLETE INSPECTION RESULTS**:
${JSON.stringify(inspectionResults, null, 2)}

**SEARCH TERMS TO USE**:
${searchTerms.map((term, index) => `${index + 1}. "${term}"`).join('\n')}

Perform the web searches and analyze the results to determine the fair market value.`;

    // Call OpenAI API with web search
    const response = await openai.responses.create({
      model: "gpt-4.1",
      tools: [
        {
          type: "web_search_preview",
          search_context_size: "high"
        }
      ],
      input: analysisPrompt,
      temperature: 0.1,
      text: {
        format: {
          name: "fair_market_value_analysis",
          strict: true,
          type: "json_schema",
          schema: FAIR_MARKET_VALUE_SCHEMA
        }
      }
    });

    // Parse response
    const marketValueAnalysis = parseResponse(response);

    // Get external valuation
    const externalValuation = await getExternalValuation(year, make, model, mileage, location);
    
    // Overwrite the OpenAI-derived field with external API result
    marketValueAnalysis.finalFairValueUSD = externalValuation.finalRange;
    marketValueAnalysis.finalFairAverageValueUSD = externalValuation.average;

    if (marketValueAnalysis.error) {
      throw new Error(`Fair market value analysis parsing failed: ${marketValueAnalysis.error}`);
    }

    // Calculate cost and extract web search results
    const cost = calculateCost(response);
    const searchResults = extractSearchResults(response);

    // Ensure web_search_results are included in the analysis result
    if (!marketValueAnalysis.web_search_results) {
      marketValueAnalysis.web_search_results = searchResults.webSearchResults;
    }

    if (Array.isArray(marketValueAnalysis.web_search_results)) {
      searchResults.webSearchCount = marketValueAnalysis.web_search_results.length;
    }

    // Update job with results
    const updateResult = await supabase
      .from("processing_jobs")
      .update({
        status: "completed",
        chunk_result: marketValueAnalysis,
        cost: cost.totalCost,
        total_tokens: cost.totalTokens,
        web_search_count: searchResults.webSearchCount,
        web_search_results: marketValueAnalysis.web_search_results,
        completed_at: new Date().toISOString()
      })
      .eq("id", job.id);

    if (updateResult.error) {
      console.error("Error updating fair market value job:", updateResult.error);
      throw new Error(`Failed to update job: ${updateResult.error.message}`);
    }

    console.log(`Successfully completed fair market value analysis for job ${job.id}`);

  } catch (error) {
    console.error(`Error processing fair market value job ${jobId}:`, error);

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
