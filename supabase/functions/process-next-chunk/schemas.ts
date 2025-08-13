/**
 * Type definitions and interfaces for the process-next-chunk function
 */

// Request/Response Types
export interface ProcessNextChunkPayload {
  inspection_id: string;
  completed_sequence?: number;
}

export interface ProcessNextChunkResponse {
  message: string;
  inspectionId: string;
}

// Image and File Types
export interface ImageData {
  id: string;
  path: string;
  converted_path?: string;
  category: string;
  mimeType?: string;
}

export interface FileReference {
  uri: string;
  mimeType: string;
  category: string;
  originalPath: string;
  displayName: string;
}

// Inspection Data Types
export interface InspectionData {
  id: string;
  vin: string;
  mileage: number;
  zip: string;
  photos: ImageData[];
  obd2_codes: OBD2CodeData[];
  title_images: ImageData[];
}

export interface OBD2CodeData {
  id: string;
  code: string;
  description: string;
  image_path?: string;
  converted_path?: string;
}

// Vehicle Information
export interface VehicleInformation {
  vin: string;
  mileage: number;
  zip: string;
  vinHistory: any;
  marketPriceBands: any;
}

// Gemini API Types
export interface GeminiContentPart {
  text?: string;
  file_data?: {
    mime_type: string;
    file_uri: string;
  };
}

export interface GeminiContent {
  parts: GeminiContentPart[];
}

export interface GeminiRequestBody {
  contents: GeminiContent[];
  generationConfig: {
    responseMimeType: string;
    responseSchema: any;
    temperature: number;
  };
}

// Dify API Types
export interface DifyWorkflowPayload {
  inputs: {
    inspection_id: string;
    gemini_request_body: string;
  };
  response_mode: string;
  user: string;
}

export interface DifyStreamEvent {
  event: string;
  workflow_run_id?: string;
  task_id?: string;
  data?: any;
  message_id?: string;
  audio?: any;
  created_at?: string;
}

// Vehicle Report Schema Structure
export interface VehicleReportSection {
  problems: string[];
  score: number;
  estimatedRepairCost: number;
  costExplanation: string;
  incomplete: boolean;
  incompletion_reason: string;
}

export interface OBDCodeReport {
  code: string;
  problems: string[];
  score: number;
  estimatedRepairCost: number;
  costExplanation: string;
  incomplete: boolean;
  incompletion_reason: string;
}

export interface OBDReport {
  codes: OBDCodeReport[];
  overall: VehicleReportSection;
}

export interface RecordsReport {
  verifiedMaintenance: string[];
  discrepancies: string[];
  incomplete: boolean;
  incompletion_reason: string;
}

export interface VehicleInfo {
  Make: string;
  Model: string;
  Year: number;
  Engine: string;
  Drivetrain: string;
  "Title Status": string;
  VIN: string;
  Mileage: number;
  Location: string;
  Transmission: string;
  "Body Style": string;
  "Exterior Color": string;
  "Interior Color": string;
  Fuel: string;
}

export interface VehicleReport {
  vehicle: VehicleInfo;
  exterior: VehicleReportSection;
  interior: VehicleReportSection;
  dashboard: VehicleReportSection;
  paint: VehicleReportSection;
  rust: VehicleReportSection;
  engine: VehicleReportSection;
  undercarriage: VehicleReportSection;
  obd: OBDReport;
  title: VehicleReportSection;
  records: RecordsReport;
  overallConditionScore: number;
  overallComments: string;
}

// Error Types
export interface ProcessingError extends Error {
  inspectionId?: string;
  stage?: string;
}
