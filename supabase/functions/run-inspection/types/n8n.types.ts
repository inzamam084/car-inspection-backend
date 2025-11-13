// N8n Appraisal Payload (from Chrome Extension)
export interface N8nAppraisalPayload {
  vin: string;
  mileage?: string;
  obdii_codes?: string;
  notes?: string;
  image_urls: string[];
  appraisal_id: string;
  image_count: number;
}

// N8n Response
export interface N8nAppraisalResponse {
  vin: string;
  vehicle?: {
    year: number;
    make: string;
    model: string;
  };
  valuation?: {
    market_value: number;
    wholesale_value: number;
    recon_total: number;
  };
  condition?: {
    score: number;
  };
  html_report?: string;
  processing_time_seconds?: number;
  warnings?: {
    has_validation_warnings: boolean;
    obdii_validation_issues?: number;
  };
  render_client_side?: boolean;
}

