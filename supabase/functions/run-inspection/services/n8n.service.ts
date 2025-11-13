import {
  createJsonResponse,
  createErrorResponse,
  HTTP_STATUS,
  logInfo,
  logError,
  logDebug,
} from "../utils/logger.ts";
import { N8N_CONFIG } from "../config/n8n.config.ts";
import type { N8nAppraisalPayload, N8nAppraisalResponse } from "../types/n8n.types.ts";

/**
 * Handles n8n appraisal requests (from Chrome Extension).
 * @param payload The n8n appraisal payload.
 * @param requestId The request ID for logging.
 * @returns A Response object.
 */
export async function handleN8nAppraisalRequest(
  payload: N8nAppraisalPayload,
  requestId: string
): Promise<Response> {
  logInfo(requestId, "Processing n8n appraisal request", {
    vin: payload.vin,
    image_count: payload.image_count,
    appraisal_id: payload.appraisal_id,
  });

  // Validate required fields
  if (!payload.vin || !payload.image_urls || payload.image_urls.length === 0) {
    logError(requestId, "Missing required fields", {
      has_vin: !!payload.vin,
      has_image_urls: !!payload.image_urls,
      image_count: payload.image_urls?.length || 0,
    });
    return createErrorResponse(
      "VIN and image_urls are required.",
      HTTP_STATUS.BAD_REQUEST
    );
  }

  // Validate minimum image count
  if (payload.image_urls.length < 3) {
    logError(requestId, "Insufficient images", {
      provided: payload.image_urls.length,
      required: 3,
    });
    return createErrorResponse(
      "Minimum 3 images required for appraisal.",
      HTTP_STATUS.BAD_REQUEST
    );
  }

  // Check n8n webhook URL is configured
  if (!N8N_CONFIG.webhookUrl) {
    logError(requestId, "N8N_WEBHOOK_URL not configured");
    return createErrorResponse(
      "N8n webhook not configured. Please set N8N_WEBHOOK_URL environment variable.",
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    );
  }

  try {
    logDebug(requestId, "Calling n8n webhook", {
      webhook_url: N8N_CONFIG.webhookUrl,
      payload_size: JSON.stringify(payload).length,
      vin: payload.vin,
      image_count: payload.image_count,
    });

    // Call n8n webhook with 5-minute timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes

    const n8nStartTime = Date.now();
    const response = await fetch(N8N_CONFIG.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const n8nDuration = (Date.now() - n8nStartTime) / 1000;

    logInfo(requestId, "N8n webhook responded", {
      status: response.status,
      statusText: response.statusText,
      duration_seconds: n8nDuration,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logError(requestId, "N8n webhook returned error", {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
        duration_seconds: n8nDuration,
      });

      // Handle timeout status codes
      if (
        response.status === 524 ||
        response.status === 408 ||
        response.status === 504
      ) {
        return createErrorResponse(
          `Request timeout (HTTP ${response.status}). The workflow may still be processing. Check n8n for execution status.`,
          HTTP_STATUS.GATEWAY_TIMEOUT
        );
      }

      return createErrorResponse(
        `N8n webhook error: ${response.status} ${response.statusText}`,
        HTTP_STATUS.BAD_GATEWAY
      );
    }

    const result: N8nAppraisalResponse = await response.json();

    logInfo(requestId, "N8n webhook completed successfully", {
      vin: result.vin,
      has_report: !!result.html_report,
      processing_time: result.processing_time_seconds,
      duration_seconds: n8nDuration,
      vehicle: result.vehicle
        ? `${result.vehicle.year} ${result.vehicle.make} ${result.vehicle.model}`
        : null,
      market_value: result.valuation?.market_value || null,
    });

    return createJsonResponse(result, HTTP_STATUS.OK);
  } catch (error) {
    // Handle timeout from AbortController
    if (error instanceof Error && error.name === "AbortError") {
      logError(requestId, "N8n webhook timeout", { error: error.message });
      return createErrorResponse(
        "Request timeout after 5 minutes. The workflow may still be processing. Check n8n for execution status.",
        HTTP_STATUS.GATEWAY_TIMEOUT
      );
    }

    logError(requestId, "N8n webhook call failed", {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });

    return createErrorResponse(
      `Failed to call n8n webhook: ${(error as Error).message}`,
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    );
  }
}

/**
 * Routes the request to the n8n handler.
 * @param payload The parsed request payload.
 * @param requestId The request ID for logging.
 * @returns A promise resolving to a Response object.
 */
export async function routeRequest(
  payload: Record<string, unknown>,
  requestId: string
): Promise<Response> {
  logDebug(requestId, "Routing request to n8n handler");

  if (typeof payload !== "object" || payload === null) {
    logError(requestId, "Invalid payload format - not an object");
    return createErrorResponse(
      "Invalid payload format. Expected a JSON object.",
      HTTP_STATUS.BAD_REQUEST
    );
  }

  // Route to n8n appraisal request
  if (
    "appraisal_id" in payload &&
    "image_urls" in payload &&
    "vin" in payload
  ) {
    logDebug(requestId, "Routing to n8n appraisal handler");
    return handleN8nAppraisalRequest(payload as N8nAppraisalPayload, requestId);
  }

  // Invalid format
  logError(requestId, "Invalid payload format - missing required fields");
  return createErrorResponse(
    "Invalid payload format. Expected `vin`, `image_urls`, and `appraisal_id` fields.",
    HTTP_STATUS.BAD_REQUEST
  );
}

