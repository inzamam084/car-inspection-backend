import { geminiConfig } from "./config.ts";

// Function to calculate API cost for Gemini
export function calculateCost(response: any) {
  const usage = response.usageMetadata || {};
  const promptTokens = usage.promptTokenCount || 0;
  const completionTokens = usage.candidatesTokenCount || 0;
  const totalTokens = usage.totalTokenCount || promptTokens + completionTokens;

  const promptCost = promptTokens * geminiConfig.rates.promptTokenRate;
  const completionCost = completionTokens * geminiConfig.rates.completionTokenRate;
  const totalCost = promptCost + completionCost;

  return {
    model: "gemini-2.0-flash-exp",
    totalTokens,
    totalCost: totalCost
  };
}

// Function to extract web search results from Gemini response
export function extractSearchResults(response: any) {
  const webSearchResults: any[] = [];
  let webSearchCount = 0;

  // Gemini includes search results in the response differently
  if (response.candidates && response.candidates[0] && response.candidates[0].content) {
    const content = response.candidates[0].content;
    if (content.parts) {
      for (const part of content.parts) {
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
export function parseResponse(response: any) {
  console.log("Parsing Gemini response for fair market value analysis", response);
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
