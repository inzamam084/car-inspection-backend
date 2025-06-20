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
  required: ["finalFairValueUSD", "priceAdjustment"],
  additionalProperties: false
};

// Fair Market Value Analysis Prompt
const FAIR_MARKET_VALUE_PROMPT = `
╭────────────────────────────────────────────────────────────╮
│          ROLE & TASK                                      │
╰────────────────────────────────────────────────────────────╯
You are an **expert automotive appraiser and market analyst**.  
Your mandate is to deliver a defensible *fair-market value* for a
USED vehicle in **USD**—based on (a) structured pricing data from
authoritative sources and (b) a detailed inspection report.

╭────────────────────────────────────────────────────────────╮
│          TOOLS & DATA SOURCES                             │
╰────────────────────────────────────────────────────────────╯
1. First attempt the following structured APIs if reachable  
   • Edmunds TMV®, KBB Price Advisor, or NADA Values  
   • If an API responds, treat it as the baseline and cite it.  
2. If no API data or <3 valid comps return, perform web searches
   with the search tool exactly as listed below.


For each result, extract only listings that
• are priced in **USD** (string starts with “$”),  
• match trim/engine/drive at ≥ 80 % spec similarity, and  
• have mileage within ±20 % of {{mileage}}.

╭────────────────────────────────────────────────────────────╮
│          ANALYSIS STEPS                                    │
╰────────────────────────────────────────────────────────────╯
1. **Collect comps → baseline_price**  
   • Build an array of listing objects '{priceUSD, mileage, trim, url}.  
   • Discard outliers beyond 1.5 × IQR.  
   • Require ≥ 3 comps after filtering or mark 'insufficientData = true'.  
   • Use the **median** of remaining prices as 'baseline_price'.
2. **Condition adjustment**  
   • If inspection score < 8 / 10, cap baseline at KBB “Good” tier.  
   • Apply ± $ based on inspection defects & OBD-II codes.  
3. **Regional factor**  
   • Adjust ± $ if local comps deviate > 5 % from national median.  
4. **Repairs**  
   • Subtract estimated repair costs directly.  
5. **Currency / formatting**  
   • Ensure all math done as numbers, then convert to USD string.  
6. **Validation**  
   • If |final – baseline| > $5 000, re-check math; if still true, \
     set 'insufficientData = true'.

╭────────────────────────────────────────────────────────────╮
│          STRICT OUTPUT SCHEMA (JSON only)                  │
╰────────────────────────────────────────────────────────────╯
{
  "insufficientData": <boolean>,          // true if <3 comps
  "baselineComps": [                      // 3–12 objects
    {
      "priceUSD": <number>,               // numeric, no "$"
      "mileage": <number>,
      "trim": "<string>",
      "url": "<string>"
    }
  ],
  "priceAdjustments": {                   // dollar deltas
    "condition": <number>,
    "repairs": <number>,
    "regional": <number>,
    "other": "<string>"                   // brief narrative
  },
  "finalFairValueUSD": "<string>",        // "$25 500" or "$24 000-26 000"
  "webSearchResults": [ "<string>", ... ] // raw snippets/links
}

╭────────────────────────────────────────────────────────────╮
│          OUTPUT RULES                                     │
╰────────────────────────────────────────────────────────────╯
• **Return ONLY the JSON** that matches the schema—no markdown.  
• Numeric fields must serialize as numbers, not strings.  
• Never hallucinate listings; cite every URL you used.  
• If \`insufficientData\` is true, leave other numeric fields null.

╭────────────────────────────────────────────────────────────╮
│          RUNTIME VARIABLES                                │
╰────────────────────────────────────────────────────────────╯
You will receive:
• Vehicle specs → {year, make, model, trim, mileage, zip, location}  
• Full inspection JSON, including scores and repair-cost estimates.

Apply the analysis exactly as described—deterministically—and \
produce the JSON response.
`;

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
      `used ${year} ${make} ${model} ${mileage} mi \
   ${location} price site:autotrader.com OR site:cars.com`,
      `${year} ${make} ${model} mileage ${mileage} sold price ${location}`,
      `used ${year} ${make} ${model} price ${location} \
   site:kbb.com`,
      `used ${year} ${make} ${model} trade-in value \
   ${location} site:nadaguides.com`,
      `used ${year} ${make} ${model} ${mileage} mi \
   price ${location} site:edmunds.com`,
      `used ${year} ${make} ${model} private party \
   price ${location}`
    ];
    
    // Build analysis prompt with complete inspection data
    const analysisPrompt = `${FAIR_MARKET_VALUE_PROMPT}

**COMPLETE INSPECTION RESULTS**:
${JSON.stringify(inspectionResults, null, 2)}

**SEARCH QUERIES (use in order) **
Please perform web searches using the following queries to find comparable listings:
1. "${searchTerms[0]}"
2. "${searchTerms[1]}"
3. "${searchTerms[2]}"
4. "${searchTerms[3]}"
5. "${searchTerms[4]}"

Perform the web searches and analyze the results to determine the fair market value.`;
    
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
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // Job is already set to processing by process-next-chunk
    // No need to update status again
    
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
