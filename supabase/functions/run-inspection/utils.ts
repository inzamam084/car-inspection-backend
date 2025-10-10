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
