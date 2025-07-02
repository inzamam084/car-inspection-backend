import { supabase, geminiConfig } from "./config.ts";
import { OWNERSHIP_COST_FORECAST_PROMPT } from "./schemas.ts";
import {
  calculateCost,
  extractSearchResults,
  parseResponse,
  buildOwnershipCostSearchTerms,
  extractVehicleInfo,
  cleanInspectionResults
} from "./utils.ts";

// Background processing function
export async function processOwnershipCostForecast(jobId: string, inspectionId: string) {
  try {
    console.log(`Starting ownership cost forecast analysis for job ${jobId}`);

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
      throw new Error("No final chunk result found for ownership cost forecast analysis");
    }

    const inspectionResults = finalChunkJob.chunk_result;

    // Remove ownershipCostForecast from inspection results to avoid confusion
    const cleanedInspectionResults = cleanInspectionResults(inspectionResults);

    // Get inspection details
    const { data: inspection } = await supabase
      .from("inspections")
      .select("vin, mileage, zip")
      .eq("id", inspectionId)
      .single();

    // Extract vehicle information
    const vehicleInfo = extractVehicleInfo(inspectionResults, inspection);
    const { year, make, model, mileage, location } = vehicleInfo;

    // Build search terms
    const searchTerms = buildOwnershipCostSearchTerms(year, make, model);

    // Build analysis prompt with complete inspection data
    const analysisPrompt = `${OWNERSHIP_COST_FORECAST_PROMPT}

**COMPLETE INSPECTION RESULTS** (excluding ownershipCostForecast):
${JSON.stringify(cleanedInspectionResults, null, 2)}

**SEARCH TERMS TO USE**:
${searchTerms.map((term, index) => `${index + 1}. "${term}"`).join('\n')}

Perform the web searches and analyze the results to create an ownership cost forecast.`;

    // Call Gemini API with web search
    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: analysisPrompt
            }
          ]
        }
      ],
      tools: [
        {
          google_search: {}
        }
      ],
      generationConfig: {
        temperature: 0.1,
        topK: 40,
        topP: 0.95
      }
    };

    console.log("Sending request to Gemini API:", JSON.stringify(requestBody, null, 2));

    const response = await fetch(geminiConfig.endpoint, {
      method: "POST",
      headers: geminiConfig.headers,
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error response:", errorText);
      throw new Error(`Gemini API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const geminiResponse = await response.json();
    console.log("Gemini API response:", JSON.stringify(geminiResponse, null, 2));

    // Parse response
    const ownershipCostAnalysis = parseResponse(geminiResponse);
    if (ownershipCostAnalysis.error) {
      throw new Error(`Ownership cost forecast analysis parsing failed: ${ownershipCostAnalysis.error}`);
    }

    // Calculate cost and extract web search results
    const cost = calculateCost(geminiResponse);
    const searchResults = extractSearchResults(geminiResponse);

    // Ensure web_search_results are included in the analysis result
    if (!ownershipCostAnalysis.web_search_results) {
      ownershipCostAnalysis.web_search_results = searchResults.webSearchResults;
    }

    if (Array.isArray(ownershipCostAnalysis.web_search_results)) {
      searchResults.webSearchCount = ownershipCostAnalysis.web_search_results.length;
    }

    // Update job with results
    const updateResult = await supabase
      .from("processing_jobs")
      .update({
        status: "completed",
        chunk_result: ownershipCostAnalysis,
        cost: cost.totalCost,
        total_tokens: cost.totalTokens,
        web_search_count: searchResults.webSearchCount,
        web_search_results: ownershipCostAnalysis.web_search_results,
        completed_at: new Date().toISOString()
      })
      .eq("id", job.id);

    if (updateResult.error) {
      console.error("Error updating ownership cost forecast job:", updateResult.error);
      throw new Error(`Failed to update job: ${updateResult.error.message}`);
    }

    console.log(`Successfully completed ownership cost forecast analysis for job ${job.id}`);

  } catch (error) {
    console.error(`Error processing ownership cost forecast job ${jobId}:`, error);

    // Update job status to failed
    await supabase
      .from("processing_jobs")
      .update({
        status: "failed",
        error_message: error instanceof Error ? error.message : String(error),
        completed_at: new Date().toISOString()
      })
      .eq("id", jobId);
  }
}
