import { supabase, appConfig } from "./config.ts";
import { CostData, PdfResult } from "./schemas.ts";

export async function generatePdfReport(inspectionId: string): Promise<PdfResult> {
  try {
    const nextJsApiUrl = `${appConfig.baseUrl}/api/generate-pdf-report`;
    const response = await fetch(nextJsApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        inspectionId: inspectionId.trim()
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({
        message: "Unknown error"
      }));
      console.error("Error generating PDF report:", errorData);
      return {
        success: false,
        error: errorData
      };
    }

    const data = await response.json();
    console.log("PDF report generated successfully:", data);
    return {
      success: true,
      data
    };
  } catch (error) {
    console.error("Unexpected error generating PDF report:", error);
    return {
      success: false,
      error
    };
  }
}

export async function calculateTotalCostsFromJobs(inspectionId: string): Promise<CostData> {
  const { data: jobs } = await supabase
    .from("processing_jobs")
    .select("cost, total_tokens, web_search_count, web_search_results")
    .eq("inspection_id", inspectionId)
    .eq("status", "completed");

  if (!jobs || jobs.length === 0) {
    return {
      totalCost: 0,
      totalTokens: 0,
      totalWebSearchCount: 0,
      allWebSearchResults: []
    };
  }

  const totalCost = jobs.reduce((sum: number, job: any) => sum + (job.cost || 0), 0);
  const totalTokens = jobs.reduce((sum: number, job: any) => sum + (job.total_tokens || 0), 0);
  const totalWebSearchCount = jobs.reduce((sum: number, job: any) => sum + (job.web_search_count || 0), 0);
  const allWebSearchResults = jobs.flatMap((job: any) => job.web_search_results || []);

  return {
    totalCost,
    totalTokens,
    totalWebSearchCount,
    allWebSearchResults
  };
}
