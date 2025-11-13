/**
 * Request source types
 */
export type RequestSource = "chrome_extension" | "website";

/**
 * Chrome Extension request payload (actual structure from extension)
 */
export interface ChromeExtensionPayload {
  listing_url: string;
  thumbnail_url: string;
  price: string;
  year: number;
  make: string;
  model: string;
  mileage: string;
  gallery_images: string[]; // Note: It's gallery_images, not image_urls
  description: string;
  seller_name: string;
  seller_phone: string;
  vin?: string;
  scraped_at: string;
  platform?: string;
  email?: string;
  user_id?: string;
  type?: string; // "extension" for Chrome extension data
  
  // Screenshot and metadata
  page_screenshot?: {
    dataUrl?: string;
    storageUrl?: string;
    width: number;
    height: number;
    timestamp: number;
  };
  
  scraping_metadata?: {
    totalImages: number;
    processingTime: number;
    retries: number;
    extractedFields?: string[];
    failedFields?: string[];
    [key: string]: any;
  };
  
  // Extracted content from page
  extracted_content?: {
    complete: {
      content: string;
      wordCount: number;
      extractedAt: string;
    } | null;
    html: {
      html: string;
      text: string;
      elementCount: number;
      extractedAt: string;
    } | null;
    structured: {
      lists: Array<{ type: string; items: string[] }>;
      tables: Array<{ headers: string[]; rows: string[][] }>;
      forms: Array<{
        action?: string;
        fields: Array<{ name?: string; type: string; value?: string }>;
      }>;
      links: Array<{ text: string; url: string }>;
      extractedAt: string;
    } | null;
    extraction_metadata: {
      platform: string;
      extracted_at: string;
      has_complete: boolean;
      has_html: boolean;
      has_structured: boolean;
      word_count: number;
      element_count: number;
      lists_count: number;
      tables_count: number;
      forms_count: number;
      links_count: number;
    };
  };
}

/**
 * Website request payload
 */
export interface WebsitePayload {
  inspection_id: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
