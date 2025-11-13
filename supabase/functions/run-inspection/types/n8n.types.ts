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

// N8n Response (Complete Structure)
export interface N8nAppraisalResponse {
  success: boolean;
  render_client_side?: boolean;
  vin: string;
  vin_source?: string;
  vin_corrected?: boolean;
  vin_original?: string;
  
  vehicle: {
    year: string;
    make: string;
    model: string;
    trim?: string;
    type?: string;
    drivetrain?: string;
    engine?: string;
    transmission?: string;
    fuel_type?: string;
  };
  
  valuation: {
    market_value: number;
    wholesale_value: number;
    conservative_value?: number;
    optimistic_value?: number;
    data_confidence?: string;
    average_relevance?: number;
    recon_total: number;
    recon_item_count?: number;
    comps_found?: number;
    price_range?: {
      low: number;
      high: number;
      average: number;
      median: number;
    };
    subject_mileage?: number;
    market_position?: string;
  };
  
  condition: {
    score: number;
    damage_count?: number;
    extracted_odometer?: number;
    obdii_codes_parsed?: any[];
    obdii_codes?: number;
  };
  
  damage_categorized?: {
    exterior?: DamageItem[];
    interior?: DamageItem[];
    undercarriage?: DamageItem[];
    engine?: DamageItem[];
  };
  
  images_by_type?: {
    exterior?: ImageInfo[];
    interior?: ImageInfo[];
    undercarriage?: ImageInfo[];
    engine?: ImageInfo[];
  };
  
  images?: {
    count: number;
    urls: string[];
    analyzed: number;
    summary?: ImageInfo[];
  };
  
  appraisal_id: string;
  recon_items?: ReconItem[];
  comparable_listings?: any[];
  
  warnings?: {
    obdii_validation_issues?: number;
    has_validation_warnings: boolean;
    obdii_warnings?: any[];
  };
  
  processing_time_seconds?: number;
  timestamp?: string;
  workflow_version?: string;
  input_method?: string;
  html_report?: string;
}

// Supporting Types
export interface DamageItem {
  location: string;
  type: string;
  severity: string;
  description: string;
  confidence?: number;
  bounding_box?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  grid_zone?: string;
  reasoning?: string;
  image_source?: string;
  image_url?: string;
  image_index?: number;
  detected_at?: string;
}

export interface ImageInfo {
  image_url: string;
  image_filename: string;
  image_type: string;
  image_index: number;
  findings_count: number;
}

export interface ReconItem {
  location: string;
  type: string;
  severity: string;
  base_price: number;
  complexity_multiplier?: number;
  complexity_reasoning?: string;
  final_price: number;
  bundled?: boolean;
  problem: string;
  part_cost?: number;
  parts_cost?: number;
  labor_hours?: number;
  labor_cost?: number;
  total: number;
  total_cost: number;
  details?: string;
}

