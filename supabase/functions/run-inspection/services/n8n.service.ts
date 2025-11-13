import {
  createJsonResponse,
  createErrorResponse,
  HTTP_STATUS,
  logInfo,
  logError,
  logDebug,
} from "../utils/logger.ts";
import { N8N_CONFIG } from "../config/n8n.config.ts";
import { TIMEOUTS, LIMITS } from "../config/constants.ts";
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
  const { vin, image_count, appraisal_id, image_urls } = payload;

  logInfo(requestId, "Processing n8n appraisal request", {
    vin,
    image_count,
    appraisal_id,
  });

  // Validate required fields
  if (!vin || !image_urls || image_urls.length === 0) {
    logError(requestId, "Missing required fields", {
      has_vin: !!vin,
      has_image_urls: !!image_urls,
      image_count: image_urls?.length || 0,
    });
    return createErrorResponse(
      "VIN and image_urls are required.",
      HTTP_STATUS.BAD_REQUEST
    );
  }

  // Validate minimum image count
  if (image_urls.length < LIMITS.MIN_IMAGES_REQUIRED) {
    logError(requestId, "Insufficient images", {
      provided: image_urls.length,
      required: LIMITS.MIN_IMAGES_REQUIRED,
    });
    return createErrorResponse(
      `Minimum ${LIMITS.MIN_IMAGES_REQUIRED} images required for appraisal.`,
      HTTP_STATUS.BAD_REQUEST
    );
  }

  // Check n8n webhook URL is configured
  const { webhookUrl } = N8N_CONFIG;
  if (!webhookUrl) {
    logError(requestId, "N8N_WEBHOOK_URL not configured");
    return createErrorResponse(
      "N8n webhook not configured. Please set N8N_WEBHOOK_URL environment variable.",
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    );
  }

  try {
    logDebug(requestId, "Calling n8n webhook", {
      webhook_url: webhookUrl,
      payload_size: JSON.stringify(payload).length,
      vin,
      image_count,
    });

    // Call n8n webhook with configured timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUTS.N8N_WEBHOOK);

    const n8nStartTime = Date.now();
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const n8nDuration = (Date.now() - n8nStartTime) / 1000;

    const { status, statusText, ok } = response;

    logInfo(requestId, "N8n webhook responded", {
      status,
      statusText,
      duration_seconds: n8nDuration,
    });

    if (!ok) {
      const errorText = await response.text();
      logError(requestId, "N8n webhook returned error", {
        status,
        statusText,
        error: errorText,
        duration_seconds: n8nDuration,
      });

      // Handle timeout status codes
      if (status === 524 || status === 408 || status === 504) {
        return createErrorResponse(
          `Request timeout (HTTP ${status}). The workflow may still be processing. Check n8n for execution status.`,
          HTTP_STATUS.GATEWAY_TIMEOUT
        );
      }

      return createErrorResponse(
        `N8n webhook error: ${status} ${statusText}`,
        HTTP_STATUS.BAD_GATEWAY
      );
    }

    const result: N8nAppraisalResponse = await response.json();
    const { 
      vin: resultVin, 
      html_report, 
      processing_time_seconds, 
      vehicle, 
      valuation 
    } = result;

    logInfo(requestId, "N8n webhook completed successfully", {
      vin: resultVin,
      has_report: !!html_report,
      processing_time: processing_time_seconds,
      duration_seconds: n8nDuration,
      vehicle: vehicle
        ? `${vehicle.year} ${vehicle.make} ${vehicle.model}`
        : null,
      market_value: valuation?.market_value || null,
    });

    return createJsonResponse(result, HTTP_STATUS.OK);
  } catch (error) {
    // Handle timeout from AbortController
    if (error instanceof Error && error.name === "AbortError") {
      logError(requestId, "N8n webhook timeout", { error: error.message });
      return createErrorResponse(
        `Request timeout after ${TIMEOUTS.N8N_WEBHOOK / 1000} seconds. The workflow may still be processing. Check n8n for execution status.`,
        HTTP_STATUS.GATEWAY_TIMEOUT
      );
    }

    const { message, stack } = error as Error;
    logError(requestId, "N8n webhook call failed", {
      error: message,
      stack,
    });

    return createErrorResponse(
      `Failed to call n8n webhook: ${message}`,
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    );
  }
}

