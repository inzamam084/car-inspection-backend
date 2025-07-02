import { openaiConfig } from "./config.ts";

// Function to calculate API cost
export function calculateCost(response: any) {
  const usage = response.usage || {};
  const promptTokens = usage.input_tokens || 0;
  const completionTokens = usage.output_tokens || 0;
  const totalTokens = usage.total_tokens || promptTokens + completionTokens;

  const promptCost = promptTokens * openaiConfig.rates.promptTokenRate;
  const completionCost = completionTokens * openaiConfig.rates.completionTokenRate;
  const totalCost = promptCost + completionCost;

  return {
    model: response.model || openaiConfig.model,
    totalTokens,
    totalCost: totalCost
  };
}

// Function to extract web search results
export function extractSearchResults(response: any) {
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

  return {
    webSearchResults,
    webSearchCount
  };
}

// Function to parse OpenAI response
export function parseResponse(response: any) {
  try {
    const analysisResult = response.output_text || 
      response.output && response.output[0] && response.output[0].content && 
      response.output[0].content[0] && response.output[0].content[0].text || "{}";
    return JSON.parse(analysisResult);
  } catch (error) {
    console.error("Error parsing OpenAI response:", error);
    return {
      error: "Failed to parse analysis result"
    };
  }
}

// Function to build vehicle search terms
export function buildVehicleSearchTerms(year: string, make: string, model: string, mileage: string, location: string): string[] {
  return [
    `${year} ${make} ${model} ${mileage} market value KBB`,
    `${year} ${make} ${model} for sale ${location} AutoTrader`,
    `${year} ${make} ${model} Edmunds value pricing`,
    `${year} ${make} ${model} ${mileage} miles Cars.com CarMax price`,
    `${year} ${make} ${model} trade-in value NADA blue book pricing`
  ];
}

// Function to call external valuation API
export async function getExternalValuation(year: string, make: string, model: string, mileage: string, location: string) {
  const valuationRes = await fetch("https://v0-fix-mate-git-staging-infinione-projects.vercel.app/api/vehicle-valuation", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      year,
      make,
      model,
      mileage,
      location
    })
  });

  if (!valuationRes.ok) {
    throw new Error(`Valuation API error: ${valuationRes.status} ${valuationRes.statusText}`);
  }

  const { fairMarketValue } = await valuationRes.json();
  
  // Build a "$low – $high" string
  const low = fairMarketValue.low.toLocaleString();
  const high = fairMarketValue.high.toLocaleString();
  const finalRange = `$${low} - $${high}`;
  
  return {
    finalRange,
    average: fairMarketValue.average.toLocaleString()
  };
}
