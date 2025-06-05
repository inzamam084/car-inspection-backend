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

// Fair Market Value Response Schema
const FAIR_MARKET_VALUE_SCHEMA = {
  type: "object",
  properties: {
    finalFairValueUSD: { 
      type: "string",
      description: "Final fair market value in USD format (e.g., '$15,000 - $18,000' or '$16,500')"
    },
    priceAdjustment: {
      type: "object",
      properties: {
        baselineBand: { type: "string", enum: ["concours", "excellent", "good", "fair"] },
        adjustmentUSD: { type: "integer" },
        explanation: { type: "string" }
      },
      required: ["baselineBand", "adjustmentUSD", "explanation"],
      additionalProperties: false
    }
  },
  required: ["finalFairValueUSD", "priceAdjustment"],
  additionalProperties: false
};

// Fair Market Value Analysis Prompt
const FAIR_MARKET_VALUE_PROMPT = `You are an expert automotive appraiser and market analyst. Your task is to determine the fair market value of a vehicle based on web search results and the vehicle's inspection condition.

**ANALYSIS REQUIREMENTS**:
1. **Market Data Collection**: Use web search results to establish baseline market values from multiple sources
2. **Condition Assessment**: Apply condition-based adjustments based on the provided inspection results
3. **Price Calculation**: Determine a specific dollar amount or range for finalFairValueUSD
4. **Documentation**: Provide clear explanations for all adjustments and market analysis

**VEHICLE DATA**: You will receive:
- Vehicle details (Year, Make, Model, Mileage, Location)
- Complete inspection results with condition scores and identified issues
- Repair cost estimates from the inspection

**OUTPUT REQUIREMENTS**:
- Return ONLY a JSON object following the schema
- finalFairValueUSD must be a specific dollar amount or narrow range (e.g., "$15,000 - $18,000" or "$16,500")
- DO NOT return "Market Data Not Available" unless all searches completely fail
- Base adjustments on actual inspection findings and market data
- Provide detailed explanations for price adjustments

**PRICING LOGIC**:
1. Start with baseline market value from web searches
2. Apply condition adjustments based on inspection scores and repair costs
3. Consider regional market factors from location data
4. Factor in any significant issues or advantages found in inspection

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
async function processFairMarketValueInBackground(jobId: string, inspectionId: string) {
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
      throw new Error("No final chunk result found for fair market value analysis");
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
    
    // Build search terms
    const searchTerms = [
      `${year} ${make} ${model} ${mileage} market value KBB`,
      `${year} ${make} ${model} for sale ${location} AutoTrader`,
      `${year} ${make} ${model} Edmunds value pricing`,
      `${year} ${make} ${model} ${mileage} miles Cars.com CarMax price`,
      `${year} ${make} ${model} trade-in value NADA blue book pricing`
    ];
    
    // Build analysis prompt with vehicle and inspection data
    const analysisPrompt = `${FAIR_MARKET_VALUE_PROMPT}

**VEHICLE INFORMATION**:
Year: ${year}
Make: ${make}
Model: ${model}
Mileage: ${mileage}
Location: ${location}
VIN: ${vehicle.VIN}

**INSPECTION RESULTS**:
Overall Condition Score: ${inspectionResults.overallConditionScore}/10
Overall Comments: ${inspectionResults.overallComments}

**CONDITION BREAKDOWN**:
- Exterior: Score ${inspectionResults.exterior?.score}/10, Repair Cost: $${inspectionResults.exterior?.estimatedRepairCost}
- Interior: Score ${inspectionResults.interior?.score}/10, Repair Cost: $${inspectionResults.interior?.estimatedRepairCost}
- Engine: Score ${inspectionResults.engine?.score}/10, Repair Cost: $${inspectionResults.engine?.estimatedRepairCost}
- Paint: Score ${inspectionResults.paint?.score}/10, Repair Cost: $${inspectionResults.paint?.estimatedRepairCost}
- Rust: Score ${inspectionResults.rust?.score}/10, Repair Cost: $${inspectionResults.rust?.estimatedRepairCost}

**TOTAL ESTIMATED REPAIR COSTS**: $${
  (inspectionResults.exterior?.estimatedRepairCost || 0) +
  (inspectionResults.interior?.estimatedRepairCost || 0) +
  (inspectionResults.engine?.estimatedRepairCost || 0) +
  (inspectionResults.paint?.estimatedRepairCost || 0) +
  (inspectionResults.rust?.estimatedRepairCost || 0) +
  (inspectionResults.dashboard?.estimatedRepairCost || 0) +
  (inspectionResults.undercarriage?.estimatedRepairCost || 0) +
  (inspectionResults.title?.estimatedRepairCost || 0)
}

**SEARCH TERMS TO USE**:
1. "${searchTerms[0]}"
2. "${searchTerms[1]}"
3. "${searchTerms[2]}"

Perform the web searches and analyze the results to determine the fair market value.`;
    
    // Call OpenAI API with web search
    const response = await openai.responses.create({
      model: "gpt-4.1",
      tools: [{ 
        type: "web_search_preview",
        search_context_size: "medium"
      }],
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
    const marketValueAnalysis = parseAnalysisResponse(response);
    
    if (marketValueAnalysis.error) {
      throw new Error(`Fair market value analysis parsing failed: ${marketValueAnalysis.error}`);
    }
    
    // Calculate cost and extract web search results
    const cost = calculateApiCost(response);
    const searchResults = extractWebSearchResults(response);
    
    // Update job with results
    const updateResult = await supabase
      .from("processing_jobs")
      .update({
        status: "completed",
        chunk_result: marketValueAnalysis,
        cost: cost.totalCost,
        total_tokens: cost.totalTokens,
        web_search_count: searchResults.webSearchCount,
        web_search_results: searchResults.webSearchResults,
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
      .eq("status", "pending")
      .single();
    
    if (jobError || !job) {
      console.error("Error fetching fair market value job:", jobError);
      return new Response(JSON.stringify({
        error: "No pending fair market value job found"
      }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // Update job status to processing
    await supabase
      .from("processing_jobs")
      .update({
        status: "processing",
        started_at: new Date().toISOString()
      })
      .eq("id", job.id);
    
    // Start background processing using EdgeRuntime.waitUntil
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      EdgeRuntime.waitUntil(processFairMarketValueInBackground(job.id, inspectionId));
    } else {
      // Fallback for environments without EdgeRuntime.waitUntil
      processFairMarketValueInBackground(job.id, inspectionId).catch(error => {
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
      headers: { "Content-Type": "application/json" }
    });
    
  } catch (error) {
    console.error("Unexpected error in fair-market-value-researcher:", error);
    return new Response(JSON.stringify({
      error: "Internal server error"
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});
