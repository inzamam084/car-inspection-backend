// Job type constants
export const JOB_TYPES = {
  CHUNK_ANALYSIS: "chunk_analysis",
  OWNERSHIP_COST_FORECAST: "ownership_cost_forecast",
  FAIR_MARKET_VALUE: "fair_market_value",
  EXPERT_ADVICE: "expert_advice"
} as const;

// Job status constants
export const JOB_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed"
} as const;

// Inspection status constants
export const INSPECTION_STATUS = {
  FINALIZING: "finalizing",
  DONE: "done",
  FAILED: "failed"
} as const;

// Type definitions
export interface CostData {
  totalCost: number;
  totalTokens: number;
  totalWebSearchCount: number;
  allWebSearchResults: any[];
}

export interface PdfResult {
  success: boolean;
  data?: any;
  error?: any;
}

export interface VehicleInfo {
  vin: string;
}

export interface FinalReportResponse {
  success: boolean;
  message: string;
  inspectionId: string;
  reportId: string;
  totalChunks: number;
  overallScore: number;
}

export interface ErrorResponse {
  error: string;
  message?: string;
}
