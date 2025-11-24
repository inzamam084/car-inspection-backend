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
 * Fire N8N webhook without waiting for response (true fire-and-forget)
 * @param payload The n8n appraisal payload
 * @param requestId The request ID for logging
 * @returns Success status (always succeeds unless config error)
 */
export function fireN8nWebhookAsync(
  payload: N8nAppraisalPayload,
  requestId: string
): { success: boolean; error?: string } {
  const { webhookUrl } = N8N_CONFIG;

  if (!webhookUrl) {
    logError(requestId, "N8N_WEBHOOK_URL not configured");
    return {
      success: false,
      error: "N8n webhook not configured"
    };
  }

  logDebug(requestId, "Firing N8N webhook (fire-and-forget)", {
    webhook_url: webhookUrl,
    appraisal_id: payload.appraisal_id,
    vin: payload.vin,
    image_count: payload.image_count
  });

  // Fire and forget - don't wait for response
  // Use Promise.resolve to ensure we don't block
  fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }).catch((error) => {
    // Log errors but don't fail - webhook might still have been received
    logError(requestId, "N8N webhook call failed (fire-and-forget)", {
      error: error instanceof Error ? error.message : String(error),
      appraisal_id: payload.appraisal_id
    });
  });

  // Return immediately - we don't wait for the fetch to complete
  logInfo(requestId, "N8N webhook fired (not waiting for response)", {
    appraisal_id: payload.appraisal_id
  });

  return { success: true };
}

/**
 * Fetch recent N8N executions and find completed ones
 * @param requestId The request ID for logging
 * @returns Array of completed executions with appraisal IDs
 */
export async function fetchRecentN8nExecutions(
  requestId: string
): Promise<{
  success: boolean;
  executions?: Array<{
    executionId: string;
    appraisalId: string;
    status: string;
    result: N8nAppraisalResponse;
  }>;
  error?: string;
}> {
  const { apiKey, workflowId, webhookUrl } = N8N_CONFIG;

  if (!apiKey || !workflowId) {
    return {
      success: false,
      error: "N8N API key or workflow ID not configured"
    };
  }

  try {
    // Extract base URL from webhook URL
    const url = new URL(webhookUrl);
    const baseUrl = `${url.protocol}//${url.host}`;

    // Fetch recent successful executions (last 50)
    const apiUrl = `${baseUrl}/api/v1/executions?workflowId=${workflowId}&limit=50&includeData=true`;

    logDebug(requestId, "Fetching recent N8N executions", { api_url: apiUrl });

    const response = await fetch(apiUrl, {
      headers: {
        'X-N8N-API-KEY': apiKey,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      logError(requestId, "N8N API returned error", {
        status: response.status,
        error: errorText
      });
      return {
        success: false,
        error: `N8N API error: ${response.status}`
      };
    }

    const data = await response.json();

    if (!data.data || data.data.length === 0) {
      logDebug(requestId, "No recent N8N executions found");
      return { success: true, executions: [] };
    }

    // Parse executions and extract results
    const executions = data.data
      .filter((exec: Record<string, unknown>) => exec.finished === true && exec.status === 'success')
      .map((exec: Record<string, unknown>) => {
        try {
          // Extract result from last node's output
          const execData = exec.data as Record<string, unknown> | undefined;
          const resultData = execData?.resultData as Record<string, unknown> | undefined;
          const runData = resultData?.runData as Record<string, unknown> | undefined;

          if (!runData) return null;

          const lastNodeName = Object.keys(runData).pop();
          if (!lastNodeName) return null;

          const nodeData = runData[lastNodeName] as unknown[];
          const outputData = (nodeData?.[0] as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
          const mainData = outputData?.main as unknown[][];
          const jsonData = mainData?.[0]?.[0] as Record<string, unknown> | undefined;
          const json = jsonData?.json as Record<string, unknown> | undefined;

          if (!json) return null;

          // Extract appraisal_id (could be appraisal_id or appraisalId)
          const appraisalId = json.appraisal_id || json.appraisalId;

          if (!appraisalId || typeof appraisalId !== 'string') {
            logDebug(requestId, "Execution missing appraisal_id", {
              execution_id: exec.id
            });
            return null;
          }

          return {
            executionId: exec.id as string,
            appraisalId: appraisalId,
            status: 'completed',
            result: json as unknown as N8nAppraisalResponse
          };
        } catch (err) {
          logError(requestId, "Error parsing execution", {
            execution_id: exec.id,
            error: err instanceof Error ? err.message : String(err)
          });
          return null;
        }
      })
      .filter((exec: { executionId: string; appraisalId: string; status: string; result: N8nAppraisalResponse } | null): exec is { executionId: string; appraisalId: string; status: string; result: N8nAppraisalResponse } => exec !== null);

    logInfo(requestId, "Fetched N8N executions", {
      total_fetched: data.data.length,
      with_appraisal_id: executions.length
    });

    return { success: true, executions };

  } catch (error) {
    const { message } = error as Error;
    logError(requestId, "Failed to fetch N8N executions", { error: message });

    return {
      success: false,
      error: message
    };
  }
}

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

