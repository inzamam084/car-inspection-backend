import { geminiConfig } from "./config.ts";

export function calculateCost(response: any) {
  const usage = response.usageMetadata || {};
  const promptTokens = usage.promptTokenCount || 0;
  const completionTokens = usage.candidatesTokenCount || 0;
  const totalTokens = usage.totalTokenCount || promptTokens + completionTokens;

  const promptCost = promptTokens * geminiConfig.rates.promptTokenRate;
  const completionCost = completionTokens * geminiConfig.rates.completionTokenRate;
  const totalCost = promptCost + completionCost;

  return {
    model: response.modelVersion || "gemini-model",
    totalTokens,
    totalCost
  };
}

export function extractSearchResults(response: any) {
  const webSearchResults: any[] = [];
  let webSearchCount = 0;

  if (response.candidates && Array.isArray(response.candidates)) {
    for (const candidate of response.candidates) {
      if (candidate.content && Array.isArray(candidate.content)) {
        for (const content of candidate.content) {
          if (content.parts && Array.isArray(content.parts)) {
            for (const part of content.parts) {
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

export function parseResponse(response: any) {
  try {
    const analysisResult = response.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    return JSON.parse(analysisResult);
  } catch (error) {
    console.error("Error parsing response:", error);
    return {
      error: "Failed to parse response"
    };
  }
}

export function buildVehicleSearchTerms(year: string, make: string, model: string): string[] {
  return [
    `${year} ${make} ${model} common problems reliability issues expert review`,
    `${year} ${make} ${model} buying guide automotive journalist mechanic advice`,
    `${year} ${make} ${model} recalls TSB technical service bulletins NHTSA`,
    `${year} ${make} ${model} owner reviews problems complaints CarGurus`,
    `${year} ${make} ${model} maintenance schedule service intervals expert tips`
  ];
}

export function extractIssues(inspectionResults: any): string[] {
  const issues: string[] = [];

  if (inspectionResults.exterior?.problems?.length > 0) {
    issues.push(`Exterior: ${inspectionResults.exterior.problems.join(', ')}`);
  }
  if (inspectionResults.engine?.problems?.length > 0) {
    issues.push(`Engine: ${inspectionResults.engine.problems.join(', ')}`);
  }
  if (inspectionResults.rust?.problems?.length > 0) {
    issues.push(`Rust: ${inspectionResults.rust.problems.join(', ')}`);
  }

  return issues;
}
