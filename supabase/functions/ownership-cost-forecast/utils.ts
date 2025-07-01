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

// Function to build search terms for ownership cost forecast
export function buildOwnershipCostSearchTerms(year: string, make: string, model: string): string[] {
  return [
    `${year} ${make} ${model} maintenance schedule service intervals official`,
    `${year} ${make} ${model} common problems typical repairs owner forums`,
    `${year} ${make} ${model} maintenance costs parts pricing labor`,
    `site:fcpeuro.com ${year} ${make} ${model} parts pricing`,
    `site:ecstuning.com ${year} ${make} ${model} maintenance parts cost`
  ];
}

// Function to extract vehicle information from inspection results
export function extractVehicleInfo(inspectionResults: any, inspection: any) {
  const vehicle = inspectionResults.vehicle || {};
  return {
    year: vehicle.Year,
    make: vehicle.Make,
    model: vehicle.Model,
    mileage: vehicle.Mileage || inspection?.mileage,
    location: inspection?.zip || vehicle.Location
  };
}

// Function to clean inspection results (remove ownershipCostForecast to avoid confusion)
export function cleanInspectionResults(inspectionResults: any) {
  const cleanedInspectionResults = { ...inspectionResults };
  delete cleanedInspectionResults.ownershipCostForecast;
  return cleanedInspectionResults;
}
