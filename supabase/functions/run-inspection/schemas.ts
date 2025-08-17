export interface Photo {
  id: string;
  category: string;
  path: string;
  storage: string;
  converted_path?: string;
}

export interface OBD2Code {
  id: string;
  code: string;
  description: string;
  screenshot_path?: string;
  storage: string;
  converted_path?: string;
}

export interface TitleImage {
  id: string;
  path: string;
  storage: string;
  converted_path?: string;
}

export interface Inspection {
  id: string;
  vin: string;
  email: string;
  mileage?: number;
  zip?: string;
  type?: string;
  url?: string;
}

export interface ChunkImage {
  id: string;
  path: string;
  category: string;
  storage: number;
  type: 'photo' | 'obd2_image' | 'title_image';
  code?: string;
  description?: string;
}

export interface ImageChunk {
  images: ChunkImage[];
  totalSize: number;
  chunkIndex: number;
}

export interface ProcessingJob {
  inspection_id: string;
  job_type: 'chunk_analysis' | 'ownership_cost_forecast' | 'fair_market_value' | 'expert_advice';
  sequence_order: number;
  chunk_index: number;
  total_chunks: number;
  chunk_data: {
    images?: ChunkImage[];
  };
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

export interface WebhookPayload {
  inspection_id: string;
}

export interface ExtensionVehicleData {
  description: string;
  gallery_images: string[];
  listing_url: string;
  make: string;
  mileage: string;
  model: string;
  price: string;
  scraped_at: string;
  seller_name: string;
  seller_phone: string;
  thumbnail_url: string;
  vin: string;
  year: number;
  email?: string; // User email for the inspection
  user_id?: string; // Optional user ID for tracking
}

export interface ExtensionPayload {
  vehicleData: ExtensionVehicleData;
}

export interface ApiResponse {
  success: boolean;
  message: string;
  inspectionId: string;
  status: string;
}

export interface ErrorResponse {
  error: string;
}

export interface ImageCategorizationResult {
  category: 'exterior' | 'interior' | 'dashboard' | 'engine' | 'undercarriage' | 'paint' | 'rust' | 'obd' | 'title' | 'records';
  confidence: number;
  reasoning: string;
}

export interface DifyApiRequest {
  inputs: {
    query: string;
  };
  response_mode: "blocking";
  user: string;
  files: Array<{
    type: "image";
    transfer_method: "remote_url";
    url: string;
  }>;
}

export interface DifyApiResponse {
  event: string;
  task_id: string;
  id: string;
  message_id: string;
  mode: string;
  answer: string;
  metadata: {
    annotation_reply: null;
    retriever_resources: any[];
    usage: {
      prompt_tokens: number;
      prompt_unit_price: string;
      prompt_price_unit: string;
      prompt_price: string;
      completion_tokens: number;
      completion_unit_price: string;
      completion_price_unit: string;
      completion_price: string;
      total_tokens: number;
      total_price: string;
      currency: string;
      latency: number;
    };
  };
  created_at: number;
}

export interface UploadResult {
  success: boolean;
  originalUrl: string;
  supabaseUrl?: string;
  filename?: string;
  category?: string;
  error?: string;
}
