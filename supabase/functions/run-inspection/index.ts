import { serve, ConnInfo } from "https://deno.land/std@0.168.0/http/server.ts";
import { withSubscriptionCheck } from "../shared/subscription-middleware.ts";
import { authenticateUser } from "../shared/database-service.ts";
import {
  parseRequestBody,
  createErrorResponse,
  getStatusForSubscriptionError,
  HTTP_STATUS,
} from "./utils.ts";
import { routeRequest } from "./handlers.ts";
import { RequestContext } from "./logging.ts";
import { SUPABASE_CONFIG } from "./config.ts";

/**
 * Fallback function that calls the run-inspection-old API when token is not available
 */
async function callRunInspectionOldAPI(payload: any, ctx: RequestContext): Promise<Response> {
  try {
    ctx.info("Token not available, calling run-inspection-old API");

    // Make HTTP request to run-inspection-old function
    const response = await fetch(`${SUPABASE_CONFIG.url}/functions/v1/run-inspection-old`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_CONFIG.serviceKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      ctx.error("run-inspection-old API call failed", {
        status: response.status,
        status_text: response.statusText,
        error_text: errorText,
      });
      
      return createErrorResponse(
        `Fallback API call failed: ${response.statusText}`,
        response.status
      );
    }

    // Get the response data and forward it
    const responseData = await response.json();
    ctx.info("Successfully called run-inspection-old API", {
      response_status: response.status,
    });

    return new Response(JSON.stringify(responseData), {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
      },
    });

  } catch (error) {
    ctx.error("Error calling run-inspection-old API", {
      error: (error as Error).message,
    });
    
    return createErrorResponse(
      "Failed to call fallback API",
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    );
  }
}

// --- Main Server ---
serve(async (req: Request, connInfo: ConnInfo) => {
  const ctx = new RequestContext();
  const { remoteAddr } = connInfo;

  ctx.info("Request received", {
    url: req.url,
    method: req.method,
    remote_addr: remoteAddr.hostname,
  });

  try {
    // 1. Parse and Validate Request Body
    ctx.debug("Parsing request body");
    const payload = await parseRequestBody(req);
    ctx.setRequestData(payload);
    ctx.debug("Request body parsed successfully", {
      payload_type: typeof payload,
      has_inspection_id: "inspection_id" in (payload as any),
      has_vehicle_data:
        "vehicleData" in (payload as any) ||
        "gallery_images" in (payload as any),
    });

    // 2. Authenticate User from JWT
    ctx.debug("Authenticating user from JWT");
    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) {
      ctx.warn("Authentication failed, calling run-inspection-old API", authError);
      //       ctx.error("Authentication failed", authError);
      // ctx.logError("Authentication required");
      // return createErrorResponse(
      //   "Authentication required.",
      //   HTTP_STATUS.UNAUTHORIZED
      // );

      // Fallback to run-inspection-old API when token is not available
      return await callRunInspectionOldAPI(payload, ctx);
    }
    ctx.setUser(user.id);
    ctx.info("User authenticated successfully", { user_id: "[PRESENT]" });

    // 3. Perform Subscription and Usage Check
    ctx.debug("Performing subscription and usage check");
    const subscriptionCheck = await withSubscriptionCheck(user.id, {
      requireSubscription: true,
      checkUsageLimit: true,
      incrementUsage: true,
    });
    if (!subscriptionCheck.success) {
      ctx.error("Subscription check failed", {
        user_id: "[PRESENT]",
        error: subscriptionCheck.error,
        code: subscriptionCheck.code,
      });
      const status = getStatusForSubscriptionError(subscriptionCheck.code);
      ctx.logError(subscriptionCheck.error || "Subscription validation failed");
      return createErrorResponse(
        subscriptionCheck.error || "Subscription validation failed.",
        status
      );
    }
    ctx.info("Subscription check passed", {
      remaining_reports: subscriptionCheck.remainingReports,
    });

    // 4. Route to the correct business logic handler
    ctx.debug("Routing request to handler");
    const response = await routeRequest(payload, ctx);
    ctx.logSuccess({ status: response.status });
    return response;
  } catch (error) {
    ctx.error("Unhandled error in request pipeline", {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });

    // Respond to known parsing/validation errors with 400
    if (
      (error as Error).message.includes("Request body") ||
      (error as Error).message.includes("Invalid JSON")
    ) {
      ctx.logError((error as Error).message);
      return createErrorResponse(
        (error as Error).message,
        HTTP_STATUS.BAD_REQUEST
      );
    }
    // Generic fallback for all other unexpected errors
    ctx.logError("Internal server error");
    return createErrorResponse(
      "Internal server error.",
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    );
  }
});
