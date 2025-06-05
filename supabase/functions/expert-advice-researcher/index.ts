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
  required: ["advice"],
  additionalProperties: false
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
- Include expert-backed information about:
  * Common issues reported by owners and experts for this specific model/year
  * Known advantages or standout features of this vehicle
  * Model-specific maintenance tips from experts
  * Any recalls, TSBs (Technical Service Bulletins), or known defects
- Synthesize expert information with inspection findings
- MUST include web_search_results field with all search results you used in your analysis but do not include them in the advice field

**ADVICE SYNTHESIS LOGIC**:
1. Identify model-specific issues from expert sources
2. Cross-reference with actual inspection findings
3. Highlight any discrepancies or confirmations
4. Provide specific maintenance recommendations
5. Include buying decision guidance based on condition and known issues

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
async function processExpertAdviceInBackground(jobId: string, inspectionId: string) {
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
          name: "expert_advice_analysis",
          strict: true,
          type: "json_schema",
          schema: EXPERT_ADVICE_SCHEMA
        }
      }
    });
    
    // Parse response
    const expertAdviceAnalysis = parseAnalysisResponse(response);
    
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

// Main serve function
serve(async (req) => {
  try {
    console.log("Expert advice researcher request received");
    
    // Parse the request payload
    const payload = await req.json();
    const { inspection_id: inspectionId } = payload;
    
    console.log(`Starting expert advice analysis for inspection ${inspectionId}`);
    
    // Find the expert advice job for this inspection
    const { data: job, error: jobError } = await supabase
      .from("processing_jobs")
      .select("*")
      .eq("inspection_id", inspectionId)
      .eq("job_type", "expert_advice")
      .eq("status", "pending")
      .single();
    
    if (jobError || !job) {
      console.error("Error fetching expert advice job:", jobError);
      return new Response(JSON.stringify({
        error: "No pending expert advice job found"
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
      EdgeRuntime.waitUntil(processExpertAdviceInBackground(job.id, inspectionId));
    } else {
      // Fallback for environments without EdgeRuntime.waitUntil
      processExpertAdviceInBackground(job.id, inspectionId).catch(error => {
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
      headers: { "Content-Type": "application/json" }
    });
    
  } catch (error) {
    console.error("Unexpected error in expert-advice-researcher:", error);
    return new Response(JSON.stringify({
      error: "Internal server error"
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});
