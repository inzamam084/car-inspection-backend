import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { OpenAI } from "https://esm.sh/openai@4.87.3";

// Declare EdgeRuntime for background tasks
declare const EdgeRuntime: {
  waitUntil(promise: Promise<any>): void;
} | undefined;

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: Deno.env.get("OPENAI_API_KEY")
});

// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Ownership Cost Forecast Response Schema
const OWNERSHIP_COST_FORECAST_SCHEMA = {
  type: "object",
  properties: {
    ownershipCostForecast: {
      type: "array",
      items: {
        type: "object",
        properties: {
          component: { type: "string" },
          expectedIssue: { type: "string" },
          estimatedCostUSD: { type: "integer" },
          suggestedMileage: { type: "integer" },
          explanation: { type: "string" }
        },
        required: ["component", "expectedIssue", "estimatedCostUSD", "suggestedMileage", "explanation"],
        additionalProperties: false
      }
    },
    web_search_results: {
      type: "array",
      description: "All web search results used in the analysis",
      items: { 
        type: "object",
        additionalProperties: false
      }
    }
  },
  required: ["ownershipCostForecast"],
  additionalProperties: false
};

// Ownership Cost Forecast Analysis Prompt
const OWNERSHIP_COST_FORECAST_PROMPT = `You are an expert automotive maintenance advisor and cost analyst. Your task is to predict future ownership costs based on web search results for model-specific maintenance data and the vehicle's current inspection condition.

**ANALYSIS REQUIREMENTS**:
1. **Model-Specific Data Collection**: Use web search to gather maintenance schedules, common issues, and typical ownership costs for this specific vehicle
2. **Condition Assessment**: Analyze current inspection findings to predict accelerated wear or upcoming issues
3. **Cost Forecasting**: Predict maintenance and repair needs within the next ~20,000 miles based on current condition and mileage
4. **Practical Guidance**: Provide actionable forecasts with specific mileage targets and cost estimates

**VEHICLE DATA**: You will receive:
- Vehicle details (Year, Make, Model, Mileage, Location)
- Complete inspection results with condition scores and identified issues
- Current repair cost estimates from the inspection

**OUTPUT REQUIREMENTS**:
- Return ONLY a JSON object following the schema
- ownershipCostForecast must be an array of upcoming maintenance/repair items
- Each forecast item must include:
  * component: specific part/system name
  * expectedIssue: description of what will need attention
  * estimatedCostUSD: realistic cost estimate based on current market prices
  * suggestedMileage: when to expect or address this issue
  * explanation: reasoning for this prediction based on current condition and model-specific data
- Focus on items likely needed within next 20,000 miles
- Base predictions on actual inspection findings combined with model-specific maintenance schedules
- MUST include web_search_results field with all search results used in analysis

**FORECASTING LOGIC**:
1. Identify model-specific maintenance intervals from web search
2. Cross-reference with current mileage to determine upcoming services
3. Analyze inspection findings for accelerated wear patterns
4. Predict component failures based on current condition scores
5. Estimate realistic costs using current market data
6. Prioritize by urgency and cost impact

**SEARCH FOCUS AREAS**:
- Official maintenance schedules for this specific year/make/model
- Common problems and failure points reported by owners
- Typical replacement intervals for wear items (brakes, tires, etc.)
- Model-specific expensive repairs and their typical mileage occurrence
- Current parts pricing and labor costs for this vehicle type

Return only the JSON response with no additional text or markdown.`;

// Function to calculate API cost
function calculateApiCost(response: any) {
  const usage = response.usage || {};
  const promptTokens = usage.input_tokens || 0;
  const completionTokens = usage.output_tokens || 0;
  const totalTokens = usage.total_tokens || promptTokens + completionTokens;
  
  const GPT_4_1_RATES = {
    promptTokenRate: 0.01 / 1000,
    completionTokenRate: 0.03 / 1000
  };
  
  const promptCost = promptTokens * GPT_4_1_RATES.promptTokenRate;
  const completionCost = completionTokens * GPT_4_1_RATES.completionTokenRate;
  const totalCost = promptCost + completionCost;
  
  return {
    model: response.model || "gpt-4.1",
    totalTokens,
    totalCost: totalCost
  };
}

// Function to extract web search results
function extractWebSearchResults(response: any) {
  const webSearchResults: any[] = [];
  let webSearchCount = 0;
  
  if (response.output && Array.isArray(response.output)) {
    for (const outputItem of response.output) {
      if (outputItem.type === "web_search_call") {
        webSearchCount++;
        if (outputItem.results) {
          webSearchResults.push({
            searchId: outputItem.id,
            status: outputItem.status,
            results: outputItem.results,
            timestamp: new Date().toISOString()
          });
        }
      }
    }
  }
  
  return { webSearchResults, webSearchCount };
}

// Function to parse OpenAI response
function parseAnalysisResponse(response: any) {
  try {
    const analysisResult = response.output_text || response.output && response.output[0] && response.output[0].content && response.output[0].content[0] && response.output[0].content[0].text || "{}";
    return JSON.parse(analysisResult);
  } catch (error) {
    console.error("Error parsing OpenAI response:", error);
    return {
      error: "Failed to parse analysis result"
    };
  }
}

// Background processing function
async function processOwnershipCostForecastInBackground(jobId: string, inspectionId: string) {
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
    const cleanedInspectionResults = { ...inspectionResults };
    delete cleanedInspectionResults.ownershipCostForecast;
    
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
    
    // Build search terms for model-specific maintenance data
    const searchTerms = [
      `${year} ${make} ${model} maintenance schedule service intervals official`,
      `${year} ${make} ${model} common problems typical repairs owner forums`,
      `${year} ${make} ${model} parts replacement cost brake pads timing belt`
    ];
    
    // Build analysis prompt with complete inspection data
    const analysisPrompt = `${OWNERSHIP_COST_FORECAST_PROMPT}

**COMPLETE INSPECTION RESULTS** (excluding ownershipCostForecast):
${JSON.stringify(cleanedInspectionResults, null, 2)}

**VEHICLE DETAILS**:
- Year: ${year}
- Make: ${make}
- Model: ${model}
- Current Mileage: ${mileage}
- Location: ${location}

**SEARCH TERMS TO USE**:
1. "${searchTerms[0]}"
2. "${searchTerms[1]}"
3. "${searchTerms[2]}"

Perform the web searches and analyze the results to create an ownership cost forecast based on model-specific data and current inspection findings.`;
    
    // Call OpenAI API with web search
    const response = await openai.responses.create({
      model: "gpt-4.1",
      tools: [{ 
        type: "web_search_preview",
        search_context_size: "high"
      }],
      input: analysisPrompt,
      temperature: 0.1,
      text: {
        format: {
          name: "ownership_cost_forecast_analysis",
          strict: true,
          type: "json_schema",
          schema: OWNERSHIP_COST_FORECAST_SCHEMA
        }
      }
    });
    
    // Parse response
    const ownershipCostAnalysis = parseAnalysisResponse(response);
    
    if (ownershipCostAnalysis.error) {
      throw new Error(`Ownership cost forecast analysis parsing failed: ${ownershipCostAnalysis.error}`);
    }
    
    // Calculate cost and extract web search results
    const cost = calculateApiCost(response);
    const searchResults = extractWebSearchResults(response);
    
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
        error_message: error.message,
        completed_at: new Date().toISOString()
      })
      .eq("id", jobId);
  }
}

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
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // Job is already set to processing by process-next-chunk
    // No need to update status again
    
    // Start background processing using EdgeRuntime.waitUntil
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      EdgeRuntime.waitUntil(processOwnershipCostForecastInBackground(job.id, inspectionId));
    } else {
      // Fallback for environments without EdgeRuntime.waitUntil
      processOwnershipCostForecastInBackground(job.id, inspectionId).catch(error => {
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
      headers: { "Content-Type": "application/json" }
    });
    
  } catch (error) {
    console.error("Unexpected error in ownership-cost-forecast:", error);
    return new Response(JSON.stringify({
      error: "Internal server error"
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});
