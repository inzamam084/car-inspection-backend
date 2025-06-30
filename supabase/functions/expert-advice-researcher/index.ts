import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai"; // Import the Gemini client
// Initialize Google Generative AI client
const geminiClient = new GoogleGenerativeAI({
  apiKey: "AIzaSyAy2pqtvdM_h_t-a3TtgkNAFKV8cetlB0g" // Ensure to set the correct API key in the environment
});
// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);
// Expert Advice Response Schema
const EXPERT_ADVICE_SCHEMA = {
  type: "object",
  properties: {
    advice: {
      type: "string",
      description: "Expert advice based on web search results and inspection findings (≤60 words)"
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
    "advice"
  ],
  additionalProperties: false
};
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    advice: {
      type: "string"
    },
    web_search_results: {
      type: "array",
      items: {
        type: "object"
      }
    }
  },
  required: [
    "advice"
  ]
};
// Expert Advice Analysis Prompt
const EXPERT_ADVICE_PROMPT = `You are an expert automotive consultant and technical advisor. Your task is to provide expert-backed advice based on web search results and the vehicle's inspection condition.

**ANALYSIS REQUIREMENTS**:
1. **Expert Data Collection**: Use web search results to gather expert opinions, common issues, and model-specific advice
2. **Inspection Integration**: Combine expert knowledge with actual inspection findings
3. **Practical Advice**: Generate actionable advice that goes beyond generic recommendations
4. **Concise Output**: Final advice must be ≤60 words but comprehensive

**VEHICLE DATA**: You will receive:
- Vehicle details (Year, Make, Model, Mileage, Location)
- Complete inspection results with condition scores and identified issues
- Repair cost estimates from the inspection

**OUTPUT REQUIREMENTS**:
- Return ONLY a JSON object following the schema
- advice field must be ≤60 words of practical, actionable guidance
- DO NOT include any web links, URLs, or references in the advice field
- Include expert-backed information about:
  * Common issues reported by owners and experts for this specific model/year
  * Known advantages or standout features of this vehicle
  * Model-specific maintenance tips from experts
  * Any recalls, TSBs (Technical Service Bulletins), or known defects
- Synthesize expert information with inspection findings
- web_search_results field should include all search results you used in your analysis, but DO NOT include any of this content in the advice field

**DO NOT INCLUDE WEB LINKS OR REFERENCES IN THE advice FIELD.**

**EXAMPLE (CORRECT - NO LINKS)**:  
The 2002 Audi S4 is known for turbocharger failures, oil leaks, and ignition coil issues. The inspection confirms oil seepage and aftermarket modifications. Address the title discrepancy promptly. Regular maintenance is crucial for reliability. Given the high mileage and identified issues, anticipate potential repair costs.

**ADVICE SYNTHESIS LOGIC**:
1. Identify model-specific issues from expert sources
2. Cross-reference with actual inspection findings
3. Highlight any discrepancies or confirmations
4. Provide specific maintenance recommendations
5. Include buying decision guidance based on condition and known issues

Return only the JSON response with no additional text or markdown.`;
// Function to calculate API cost
function calculateApiCost(response1) {
  const usage = response1.usageMetadata || {};
  const promptTokens = usage.promptTokenCount || 0;
  const completionTokens = usage.candidatesTokenCount || 0;
  const totalTokens = usage.totalTokenCount || promptTokens + completionTokens;
  const GPT_4_1_RATES = {
    promptTokenRate: 0.01 / 1000,
    completionTokenRate: 0.03 / 1000
  };
  const promptCost = promptTokens * GPT_4_1_RATES.promptTokenRate;
  const completionCost = completionTokens * GPT_4_1_RATES.completionTokenRate;
  const totalCost = promptCost + completionCost;
  return {
    model: response1.modelVersion || "gemini-2.5-flash",
    totalTokens,
    totalCost: totalCost
  };
}
// Function to extract web search results
function extractWebSearchResults(response1) {
  const webSearchResults = [];
  let webSearchCount = 0;
  if (response1.candidates && Array.isArray(response1.candidates)) {
    for (const candidate of response1.candidates){
      if (candidate.content && Array.isArray(candidate.content)) {
        for (const content of candidate.content){
          if (content.parts && Array.isArray(content.parts)) {
            for (const part of content.parts){
              if (part.type === "web_search_call" && part.results) {
                webSearchCount++;
                webSearchResults.push({
                  searchId: part.id,
                  status: part.status,
                  results: part.results,
                  timestamp: new Date().toISOString()
                });
              }
            }
          }
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
function parseAnalysisResponse(response1) {
  try {
    console.log("Response For parsing : ", response1);
    const analysisResult = response1.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    return JSON.parse(analysisResult);
  } catch (error) {
    console.error("Error parsing Gemini response:", error);
    return {
      error: "Failed to parse analysis result"
    };
  }
}
// Background processing function
async function processExpertAdviceInBackground(jobId, inspectionId) {
  try {
    console.log(`Starting expert advice analysis for job ${jobId}`);
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
      throw new Error("No final chunk result found for expert advice analysis");
    }
    const inspectionResults = finalChunkJob.chunk_result;
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
      `${year} ${make} ${model} common problems reliability issues expert review`,
      `${year} ${make} ${model} buying guide automotive journalist mechanic advice`,
      `${year} ${make} ${model} recalls TSB technical service bulletins NHTSA`,
      `${year} ${make} ${model} owner reviews problems complaints CarGurus`,
      `${year} ${make} ${model} maintenance schedule service intervals expert tips`
    ];
    // Extract key issues from inspection
    const keyIssues = [];
    if (inspectionResults.exterior?.problems?.length > 0) {
      keyIssues.push(`Exterior issues: ${inspectionResults.exterior.problems.join(', ')}`);
    }
    if (inspectionResults.engine?.problems?.length > 0) {
      keyIssues.push(`Engine issues: ${inspectionResults.engine.problems.join(', ')}`);
    }
    if (inspectionResults.rust?.problems?.length > 0) {
      keyIssues.push(`Rust issues: ${inspectionResults.rust.problems.join(', ')}`);
    }
    // Build analysis prompt with complete inspection data
    const analysisPrompt = `${EXPERT_ADVICE_PROMPT}

**COMPLETE INSPECTION RESULTS**:
${JSON.stringify(inspectionResults, null, 2)}

**SEARCH TERMS TO USE**:
1. "${searchTerms[0]}"
2. "${searchTerms[1]}"
3. "${searchTerms[2]}"
4. "${searchTerms[3]}"
5. "${searchTerms[4]}"

Perform the web searches and analyze the results to provide expert advice that combines web research with actual inspection findings.`;
    // Call Gemini API with web search
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": "AIzaSyAy2pqtvdM_h_t-a3TtgkNAFKV8cetlB0g"
      },
      body: JSON.stringify({
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
          topP: 0.95,
          responseMimeType: "application/json"
        }
      })
    });
    console.log("Response : ", response);
    // Parse response
    const expertAdviceAnalysis = parseAnalysisResponse(await response.json());
    console.log("Expert Advice Analysis : ", expertAdviceAnalysis);
    if (expertAdviceAnalysis.error) {
      throw new Error(`Expert advice analysis parsing failed: ${expertAdviceAnalysis.error}`);
    }
    // Calculate cost and extract web search results
    const cost = calculateApiCost(response);
    const searchResults = extractWebSearchResults(response);
    // Ensure web_search_results are included in the analysis result
    if (!expertAdviceAnalysis.web_search_results) {
      expertAdviceAnalysis.web_search_results = searchResults.webSearchResults;
    }
    if (Array.isArray(expertAdviceAnalysis.web_search_results)) {
      searchResults.webSearchCount = expertAdviceAnalysis.web_search_results.length;
    }
    // Update job with results
    const updateResult = await supabase.from("processing_jobs").update({
      status: "completed",
      chunk_result: expertAdviceAnalysis,
      cost: cost.totalCost,
      total_tokens: cost.totalTokens,
      web_search_count: searchResults.webSearchCount,
      web_search_results: expertAdviceAnalysis.web_search_results,
      completed_at: new Date().toISOString()
    }).eq("id", job.id);
    if (updateResult.error) {
      console.error("Error updating expert advice job:", updateResult.error);
      throw new Error(`Failed to update job: ${updateResult.error.message}`);
    }
    console.log(`Successfully completed expert advice analysis for job ${job.id}`);
  } catch (error) {
    console.error(`Error processing expert advice job ${jobId}:`, error);
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
      EdgeRuntime.waitUntil(processExpertAdviceInBackground(job.id, inspectionId));
    } else {
      // Fallback for environments without EdgeRuntime.waitUntil
      processExpertAdviceInBackground(job.id, inspectionId).catch((error)=>{
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
