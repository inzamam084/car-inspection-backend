/**
 * Inspection data structure from database
 */
export interface InspectionData {
  id: string;
  vin: string | null;
  mileage: string | null;
  email: string | null;
  photos: Array<{
    id: string;
    path: string;
    category: string | null;
    image_url?: string | null;
  }>;
  obd2_codes: Array<{
    id: string;
    code: string | null;
    description: string | null;
  }>;
}

/**
 * Photo data structure
 */
export interface Photo {
  id: string;
  path: string;
  category: string | null;
  image_url?: string | null;
}

/**
 * OBD2 code structure
 */
export interface Obd2Code {
  id: string;
  code: string | null;
  description: string | null;
}

