// --- HTTP Constants ---
export const HTTP_STATUS = {
  OK: 200,
  ACCEPTED: 202,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  GATEWAY_TIMEOUT: 504,
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

// --- Logging Configuration ---
const LOG_TAG = "RUN_INSPECTION";
const MAX_LOG_SIZE = 10000; // Maximum characters for request/response bodies in logs
const ENABLE_DETAILED_LOGGING = true; // Set to false in production if needed

// --- Logging Utility Functions ---

export function generateRequestId(): string {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 900000) + 100000;
  return `req_${timestamp}_${random}`;
}

function truncateIfNeeded(text: string): string {
  if (text.length <= MAX_LOG_SIZE) return text;
  return `${text.substring(0, MAX_LOG_SIZE)}... [truncated, ${
    text.length - MAX_LOG_SIZE
  } more characters]`;
}

function sanitizeForLogging(data: any): any {
  if (!data) return data;

  const sanitized = JSON.parse(JSON.stringify(data));

  // Remove sensitive fields
  const sensitiveFields = ["api_key", "password", "token", "authorization"];

  function recursiveSanitize(obj: any): any {
    if (typeof obj !== "object" || obj === null) return obj;

    for (const key in obj) {
      if (sensitiveFields.some((field) => key.toLowerCase().includes(field))) {
        obj[key] = "[REDACTED]";
      } else if (typeof obj[key] === "object") {
        obj[key] = recursiveSanitize(obj[key]);
      }
    }
    return obj;
  }

  return recursiveSanitize(sanitized);
}

export function logInfo(requestId: string, message: string, data?: any): void {
  const timestamp = new Date().toISOString();
  const logData = data
    ? ` | Data: ${truncateIfNeeded(JSON.stringify(sanitizeForLogging(data)))}`
    : "";
  console.log(
    `[${LOG_TAG}] [${timestamp}] [${requestId}] INFO: ${message}${logData}`
  );
}

export function logError(requestId: string, message: string, error?: any): void {
  const timestamp = new Date().toISOString();
  const errorData = error
    ? ` | Error: ${truncateIfNeeded(JSON.stringify(error))}`
    : "";
  console.error(
    `[${LOG_TAG}] [${timestamp}] [${requestId}] ERROR: ${message}${errorData}`
  );
}

export function logWarning(requestId: string, message: string, data?: any): void {
  const timestamp = new Date().toISOString();
  const logData = data
    ? ` | Data: ${truncateIfNeeded(JSON.stringify(sanitizeForLogging(data)))}`
    : "";
  console.warn(
    `[${LOG_TAG}] [${timestamp}] [${requestId}] WARN: ${message}${logData}`
  );
}

export function logDebug(requestId: string, message: string, data?: any): void {
  if (!ENABLE_DETAILED_LOGGING) return;
  const timestamp = new Date().toISOString();
  const logData = data
    ? ` | Data: ${truncateIfNeeded(JSON.stringify(sanitizeForLogging(data)))}`
    : "";
  console.log(
    `[${LOG_TAG}] [${timestamp}] [${requestId}] DEBUG: ${message}${logData}`
  );
}

