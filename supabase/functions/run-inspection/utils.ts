import { CATEGORY_PRIORITY } from "./config.ts";
import type {
  ChunkImage,
  ImageChunk,
  OBD2Code,
  Photo,
  TitleImage,
} from "./schemas.ts";

// --- HTTP Constants ---
export const HTTP_STATUS = {
  OK: 200,
  ACCEPTED: 202,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
};

export const MIME_TYPES = {
  JSON: "application/json",
};

// --- HTTP Utility Functions ---

/**
 * Creates a standardized JSON response.
 * @param data The payload to send.
 * @param status The HTTP status code.
 * @returns A Response object.
 */
export function createJsonResponse(
  data: unknown,
  status: number = HTTP_STATUS.OK
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": MIME_TYPES.JSON },
  });
}

/**
 * Creates a standardized JSON error response.
 * @param error The error message.
 * @param status The HTTP status code.
 * @returns A Response object.
 */
export function createErrorResponse(error: string, status: number): Response {
  return createJsonResponse({ error }, status);
}

/**
 * Parses the JSON body of a request, with validation.
 * @param req The incoming Request object.
 * @returns A promise that resolves to the parsed payload.
 * @throws An error if the body is empty or invalid JSON.
 */
export async function parseRequestBody(req: Request): Promise<unknown> {
  const contentLength = req.headers.get("content-length");
  if (!contentLength || contentLength === "0") {
    throw new Error("Request body is required");
  }

  try {
    const text = await req.text();
    if (!text.trim()) {
      throw new Error("Request body is empty");
    }
    return JSON.parse(text);
  } catch (parseError) {
    console.error("JSON parsing error:", parseError);
    throw new Error("Invalid JSON in request body");
  }
}

/**
 * Maps subscription error codes to HTTP status codes.
 * @param code The subscription error code.
 * @returns An HTTP status code.
 */
export function getStatusForSubscriptionError(code?: string): number {
  switch (code) {
    case "SUBSCRIPTION_REQUIRED":
      return HTTP_STATUS.PAYMENT_REQUIRED;
    case "USAGE_LIMIT_EXCEEDED":
      return HTTP_STATUS.TOO_MANY_REQUESTS;
    case "INTERNAL_ERROR":
      return HTTP_STATUS.INTERNAL_SERVER_ERROR;
    default:
      return HTTP_STATUS.FORBIDDEN;
  }
}

// Helper function to create category-based chunks within size limit
export function createCategoryBasedChunks(
  photos: Photo[],
  obd2_codes: OBD2Code[],
  titleImages: TitleImage[],
  maxSize: number,
): ImageChunk[] {
  const chunks: ImageChunk[] = [];
  let currentChunk: ChunkImage[] = [];
  let currentSize = 0;

  // Combine all images with proper categorization
  const allImages: ChunkImage[] = [];

  // Add photos
  for (const photo of photos) {
    allImages.push({
      id: photo.id,
      path: photo.converted_path || photo.path,
      category: photo.category,
      storage: parseInt(photo.storage) || 0,
      type: "photo",
    });
  }

  // Add OBD2 images (only those with screenshot_path)
  for (const obd2 of obd2_codes) {
    if (obd2.screenshot_path) {
      allImages.push({
        id: obd2.id,
        path: obd2.converted_path || obd2.screenshot_path,
        category: "obd",
        storage: parseInt(obd2.storage) || 0,
        type: "obd2_image",
        code: obd2.code,
        description: obd2.description,
      });
    }
  }

  // Add title images
  for (const titleImg of titleImages) {
    if (titleImg.path) {
      allImages.push({
        id: titleImg.id,
        path: titleImg.converted_path || titleImg.path,
        category: "title",
        storage: parseInt(titleImg.storage) || 0,
        type: "title_image",
      });
    }
  }

  // Sort by category priority
  const sortedImages = allImages.sort((a, b) => {
    const aIndex = CATEGORY_PRIORITY.indexOf(a.category) !== -1
      ? CATEGORY_PRIORITY.indexOf(a.category)
      : CATEGORY_PRIORITY.length;
    const bIndex = CATEGORY_PRIORITY.indexOf(b.category) !== -1
      ? CATEGORY_PRIORITY.indexOf(b.category)
      : CATEGORY_PRIORITY.length;
    return aIndex - bIndex;
  });

  for (const image of sortedImages) {
    const imageSize = parseInt(image.storage.toString()) || 0;

    if (currentSize + imageSize > maxSize && currentChunk.length > 0) {
      chunks.push({
        images: [...currentChunk],
        totalSize: currentSize,
        chunkIndex: chunks.length,
      });
      currentChunk = [image];
      currentSize = imageSize;
    } else {
      currentChunk.push(image);
      currentSize += imageSize;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push({
      images: currentChunk,
      totalSize: currentSize,
      chunkIndex: chunks.length,
    });
  }

  return chunks;
}

/**
 * Utility for handling background tasks in Supabase Edge Functions
 */
export function runInBackground(task: () => Promise<void>): void {
  const backgroundTask = async () => {
    try {
      await task();
    } catch (error) {
      console.error("Background task failed:", error);
    }
  };

  // @ts-ignore: EdgeRuntime is available in Supabase Edge Functions
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
    // @ts-ignore: EdgeRuntime is available in Supabase Edge Functions
    EdgeRuntime.waitUntil(backgroundTask());
  } else {
    // Fallback for local development
    backgroundTask().catch((err) => console.error(err));
  }
}
