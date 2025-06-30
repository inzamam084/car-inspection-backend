import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// Get Gemini API key from environment
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
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
          component: {
            type: "string"
          },
          expectedIssue: {
            type: "string"
          },
          estimatedCostUSD: {
            type: "integer"
          },
          suggestedMileage: {
            type: "integer"
          },
          explanation: {
            type: "string"
          }
        },
        required: [
          "component",
          "expectedIssue",
          "estimatedCostUSD",
          "suggestedMileage",
          "explanation"
        ],
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
  required: [
    "ownershipCostForecast"
  ],
  additionalProperties: false
};
// Ownership Cost Forecast Analysis Prompt
const OWNERSHIP_COST_FORECAST_PROMPT = `
        You are an expert automotive maintenance advisor and cost analyst. Your task is to predict future ownership costs based on web search results for model-specific maintenance data and the vehicle's current inspection condition.

        **ANALYSIS REQUIREMENTS**:
        1. **Model-Specific Data Collection**: Use web search results to gather maintenance schedules, common issues, and typical ownership costs for this specific vehicle.
        2. **Condition Assessment**: Analyze current inspection findings to predict accelerated wear or upcoming issues in the future.
        3. **Cost Forecasting**: Predict maintenance and repair needs within the next ~20,000 miles based on current condition and mileage.
        4. **Documentation**: Provide clear explanations for all forecasts and cost estimates.

        **VEHICLE DATA**: You will receive:
        - Vehicle details (Year, Make, Model, Mileage, Location)
        - Complete inspection results with condition scores and identified issues.
        - Current repair cost estimates from the inspection.

        **OUTPUT REQUIREMENTS**:
        - Return ONLY a JSON object following the schema.
        - **ownershipCostForecast** must be an array of upcoming maintenance/repair items.
        - Each forecast item must include:
        * component: specific part/system name.
        * expectedIssue: description of what will need attention.
        * estimatedCostUSD: realistic cost estimate based on prices from search results and current market prices.
        * partCostUSD: realistic parts total cost estimate based on prices from search results and current market prices.
        * laborCostUSD: the labor cost associated with replacing/installing this part.
        * totalEstimatedCostUSD: sum of all part costs and labor for the entire system.
        * suggestedMileage: when to expect or address this issue.
        * explanation: reasoning for this prediction based on current condition and model-specific data. The explanation must clearly break down the costs for each part, as well as the associated reasoning for the recommendation.
        * web_search_results: all search results used in the analysis. Do not include any website URLs or references within the explanation.
        
        - Focus on items likely needed within the next 20,000 miles, so give a futuristic ownership cost forecast.
        - Base predictions on actual inspection findings combined with model-specific maintenance schedules.
        - MUST include **web_search_results** field with all search results used in the analysis.
        - DO NOT INCLUDE WEBSITE LINKS OR ANY OTHER REFERENCES IN the explanation FIELD.
        - Avoid including cleaning or rust costs; focus solely on the vehicle's parts and systems.

**FORECASTING LOGIC**:
1. **Model-Specific Maintenance Intervals**: 
    - Review the maintenance schedule for the vehicle model found through the web search results. Identify all upcoming service tasks (e.g., oil changes, brake checks) based on the vehicle's current mileage.
    - Identify any recalls or known issues specific to the make/model based on web search results.

2. **Current Mileage Analysis**:
    - Cross-reference the model's maintenance schedule with the vehicle's current mileage to determine which services are due soon. For example, if the model suggests a brake pad change every 30,000 miles, and the vehicle has 28,000 miles, the brake pads will likely need attention soon.
    - Predict when the next service task is due by comparing the current mileage with typical mileage intervals for the vehicle.

3. **Inspection Findings Integration**:
    - Incorporate any inspection findings regarding wear or damages. For example, if the inspection shows worn-out brake pads, prioritize them for the upcoming forecast.
    - Check for issues marked as "urgent" or "soon-to-become-critical" in the inspection data.

4. **Predict Future Failures**:
    - Based on the current condition of parts, estimate the likelihood of component failures. Use the inspection condition scores (e.g., brake pads rated 3/10) to predict failure timelines.
    - If a part's condition score indicates imminent failure, add it to the forecast with the predicted repair timeline and costs.

5. **Cost Estimation**:
    - Gather cost data for parts and labor from the web search results to estimate realistic repair costs. 
    - Calculate **partCostUSD** based on specific part prices found in the search results (e.g., engine oil, brake pads).
    - Calculate **laborCostUSD** based on typical labor costs for the part replacement tasks.

6. **Urgency and Cost Impact Prioritization**:
    - Prioritize items that are critical for the vehicle's functionality, such as engine-related issues or major brake repairs, over cosmetic or minor wear issues.
    - Take into account the cost of repairs relative to the vehicle's value and condition.

7. **Prediction and Forecasting**:
    - For each part/system identified in the forecast, suggest a **suggestedMileage** when the part will likely need replacement.
    - Ensure that the forecast accounts for the next ~20,000 miles, predicting when each part should be serviced or replaced, based on both mileage and inspection findings.
    - Calculate the **totalEstimatedCostUSD** for the forecasted maintenance by adding part and labor costs.

8. **Document Search Results**:
    - Ensure the **web_search_results** field includes all sources used for determining part costs, labor rates, and component failure probabilities. These sources should be compiled to back up the estimates provided in the forecast.


**REQUIRED JSON FORMAT EXAMPLE**:
{
"ownershipCostForecast": [
{
"component": "Engine Oil",
"expectedIssue": "Oil change due",
"estimatedCostUSD": 75,
"partCostUSD": 45,
"laborCostUSD": 30,
"totalEstimatedCostUSD": 75,
"suggestedMileage": 153000,
"explanation": "Based on the vehicle's maintenance schedule, an oil change is due every 5,000 miles. The current mileage suggests the next service will be required at 153,000 miles. Breakdown: Oil - $30, Filter - $15.",
"web_search_results": []
}
]
}

**CRITICAL**: Return ONLY valid JSON in exactly this format. No markdown, no explanations, no additional text. Start with { and end with }. 

`;
// Function to calculate API cost for Gemini
function calculateApiCost(response) {
  const usage = response.usageMetadata || {};
  const promptTokens = usage.promptTokenCount || 0;
  const completionTokens = usage.candidatesTokenCount || 0;
  const totalTokens = usage.totalTokenCount || promptTokens + completionTokens;
  // Gemini 2.0 Flash pricing (approximate)
  const GEMINI_RATES = {
    promptTokenRate: 0.00015 / 1000,
    completionTokenRate: 0.0006 / 1000
  };
  const promptCost = promptTokens * GEMINI_RATES.promptTokenRate;
  const completionCost = completionTokens * GEMINI_RATES.completionTokenRate;
  const totalCost = promptCost + completionCost;
  return {
    model: "gemini-2.0-flash-exp",
    totalTokens,
    totalCost: totalCost
  };
}
// Function to extract web search results from Gemini response
function extractWebSearchResults(response) {
  const webSearchResults = [];
  let webSearchCount = 0;
  // Gemini includes search results in the response differently
  if (response.candidates && response.candidates[0] && response.candidates[0].content) {
    const content = response.candidates[0].content;
    if (content.parts) {
      for (const part of content.parts){
        if (part.functionCall && part.functionCall.name === "google_search") {
          webSearchCount++;
          webSearchResults.push({
            searchId: `search_${webSearchCount}`,
            status: "completed",
            results: part.functionCall.args || {},
            timestamp: new Date().toISOString()
          });
        }
      }
    }
  }
  return {
    webSearchResults,
    webSearchCount
  };
}
// Function to parse Gemini response
function parseAnalysisResponse(response) {
  console.log("Parsing Gemini response for ownership cost forecast analysis", response);
  try {
    if (response.candidates && response.candidates[0] && response.candidates[0].content) {
      const content = response.candidates[0].content;
      if (content.parts && content.parts[0] && content.parts[0].text) {
        const analysisResult = content.parts[0].text;
        // Remove any markdown formatting if present
        const cleanedResult = analysisResult.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return JSON.parse(cleanedResult);
      }
    }
    throw new Error("No valid content found in response");
  } catch (error) {
    console.error("Error parsing Gemini response:", error);
    return {
      error: "Failed to parse analysis result"
    };
  }
}
// Background processing function
async function processOwnershipCostForecastInBackground(jobId, inspectionId) {
  try {
    console.log(`Starting ownership cost forecast analysis for job ${jobId}`);
    // Check if API key is available
    // if (!GEMINI_API_KEY) {
    //   throw new Error("GEMINI_API_KEY environment variable is not set");
    // }
    // Get the job details
    const { data: job, error: jobError } = await supabase.from("processing_jobs").select("*").eq("id", jobId).single();
    if (jobError || !job) {
      console.error("Error fetching job:", jobError);
      return;
    }
    // Get the final chunk analysis result
    const { data: finalChunkJob, error: finalChunkError } = await supabase.from("processing_jobs").select("chunk_result").eq("inspection_id", inspectionId).eq("job_type", "chunk_analysis").eq("status", "completed").order("sequence_order", {
      ascending: false
    }).limit(1).single();
    if (finalChunkError || !finalChunkJob || !finalChunkJob.chunk_result) {
      throw new Error("No final chunk result found for ownership cost forecast analysis");
    }
    const inspectionResults = finalChunkJob.chunk_result;
    // Remove ownershipCostForecast from inspection results to avoid confusion
    const cleanedInspectionResults = {
      ...inspectionResults
    };
    delete cleanedInspectionResults.ownershipCostForecast;
    // Get inspection details
    const { data: inspection } = await supabase.from("inspections").select("vin, mileage, zip").eq("id", inspectionId).single();
    // Extract vehicle information
    const vehicle = inspectionResults.vehicle || {};
    const year = vehicle.Year;
    const make = vehicle.Make;
    const model = vehicle.Model;
    const mileage = vehicle.Mileage || inspection?.mileage;
    const location = inspection?.zip || vehicle.Location;
    // Build search terms
    const searchTerms = [
      `${year} ${make} ${model} maintenance schedule service intervals official`,
      `${year} ${make} ${model} common problems typical repairs owner forums`,
      `${year} ${make} ${model} maintenance costs parts pricing labor`,
      `site:fcpeuro.com ${year} ${make} ${model} parts pricing`,
      `site:ecstuning.com ${year} ${make} ${model} maintenance parts cost`
    ];
    // Build analysis prompt with complete inspection data
    const analysisPrompt = `${OWNERSHIP_COST_FORECAST_PROMPT}

**COMPLETE INSPECTION RESULTS** (excluding ownershipCostForecast):
${JSON.stringify(cleanedInspectionResults, null, 2)}

**SEARCH TERMS TO USE**:
1. "${searchTerms[0]}"
2. "${searchTerms[1]}"
3. "${searchTerms[2]}"
4. "${searchTerms[3]}"
5. "${searchTerms[4]}"

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
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": "AIzaSyAy2pqtvdM_h_t-a3TtgkNAFKV8cetlB0g"
      },
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
    const ownershipCostAnalysis = parseAnalysisResponse(geminiResponse);
    if (ownershipCostAnalysis.error) {
      throw new Error(`Ownership cost forecast analysis parsing failed: ${ownershipCostAnalysis.error}`);
    }
    // Calculate cost and extract web search results
    const cost = calculateApiCost(geminiResponse);
    const searchResults = extractWebSearchResults(geminiResponse);
    // Ensure web_search_results are included in the analysis result
    if (!ownershipCostAnalysis.web_search_results) {
      ownershipCostAnalysis.web_search_results = searchResults.webSearchResults;
    }
    if (Array.isArray(ownershipCostAnalysis.web_search_results)) {
      searchResults.webSearchCount = ownershipCostAnalysis.web_search_results.length;
    }
    // Update job with results
    const updateResult = await supabase.from("processing_jobs").update({
      status: "completed",
      chunk_result: ownershipCostAnalysis,
      cost: cost.totalCost,
      total_tokens: cost.totalTokens,
      web_search_count: searchResults.webSearchCount,
      web_search_results: ownershipCostAnalysis.web_search_results,
      completed_at: new Date().toISOString()
    }).eq("id", job.id);
    if (updateResult.error) {
      console.error("Error updating ownership cost forecast job:", updateResult.error);
      throw new Error(`Failed to update job: ${updateResult.error.message}`);
    }
    console.log(`Successfully completed ownership cost forecast analysis for job ${job.id}`);
  } catch (error) {
    console.error(`Error processing ownership cost forecast job ${jobId}:`, error);
    // Update job status to failed
    await supabase.from("processing_jobs").update({
      status: "failed",
      error_message: error.message,
      completed_at: new Date().toISOString()
    }).eq("id", jobId);
  }
}
// Main serve function
serve(async (req)=>{
  try {
    console.log("Ownership cost forecast researcher request received");
    // Parse the request payload
    const payload = await req.json();
    const { inspection_id: inspectionId } = payload;
    console.log(`Starting ownership cost forecast analysis for inspection ${inspectionId}`);
    // Find the ownership cost forecast job for this inspection
    const { data: job, error: jobError } = await supabase.from("processing_jobs").select("*").eq("inspection_id", inspectionId).eq("job_type", "ownership_cost_forecast").eq("status", "processing").single();
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
      EdgeRuntime.waitUntil(processOwnershipCostForecastInBackground(job.id, inspectionId));
    } else {
      // Fallback for environments without EdgeRuntime.waitUntil
      processOwnershipCostForecastInBackground(job.id, inspectionId).catch((error)=>{
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
