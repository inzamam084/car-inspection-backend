import { serve, ConnInfo } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  authenticateUser,
  createDatabaseService,
} from "../shared/database-service.ts";
import {
  parseRequestBody,
  createErrorResponse,
  createJsonResponse,
  HTTP_STATUS,
  runInBackground,
} from "./utils.ts";
import { routeRequest } from "./handlers.ts";
import { RequestContext } from "./logging.ts";
import {
  withSubscriptionCheck,
  getHttpStatusForSubscriptionError,
} from "../shared/subscription-middleware.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// --- Main Server ---
serve(async (req: Request, connInfo: ConnInfo) => {
  const ctx = new RequestContext();
  const { remoteAddr } = connInfo;

  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  ctx.info("Request received", {
    url: req.url,
    method: req.method,
    remote_addr: remoteAddr.transport,
  });

  try {
    // 1. Parse and Validate Request Body
    ctx.debug("Parsing request body");
    const payload = await parseRequestBody(req);
    ctx.setRequestData(payload);
    ctx.debug("Request body parsed successfully", {
      payload_type: typeof payload,
      has_inspection_id: "inspection_id" in (payload as any),
      has_token: "token" in (payload as any),
      has_vehicle_data:
        "vehicleData" in (payload as any) ||
        "gallery_images" in (payload as any),
    });

    // 2. Authenticate User from JWT or Token
    let userId: string;
    const token = (payload as any).token;

    const db = createDatabaseService();

    if (token) {
      // Token-based authentication
      const { userId: user_id, error } = await db.authenticateWithToken(
        token,
        (payload as any).inspection_id
      );
      if (error || !user_id) {
        return createErrorResponse(
          error || "Invalid token.",
          HTTP_STATUS.FORBIDDEN
        );
      }
      ctx.setUser(user_id);
      ctx.info("Token authenticated successfully", {
        user_id: "[PRESENT]",
        source: "token",
      });
      userId = user_id;
    } else {
      // JWT-based authentication
      ctx.debug("Authenticating user from JWT");
      const { user, error: authError } = await authenticateUser(req);
      if (authError || !user) {
        return createErrorResponse(
          authError || "Authentication failed.",
          HTTP_STATUS.UNAUTHORIZED
        );
      }
      userId = user.id;
      ctx.setUser(userId);
      ctx.info("User authenticated successfully", {
        user_id: "[PRESENT]",
        source: "jwt",
      });
    }

    // 3. Check Subscription and Usage Limit BEFORE routing
    ctx.info("Checking subscription and usage limit");
    const subscriptionCheck = await withSubscriptionCheck(userId, {
      requireSubscription: true, // Allow blocks without active subscription
      checkUsageLimit: true,       // Check if user has available reports
      trackUsage: false,           // Don't track yet - will track after inspection creation
    });

    if (!subscriptionCheck.success) {
      ctx.error("Subscription check failed", {
        error: subscriptionCheck.error,
        code: subscriptionCheck.code,
        remaining_reports: subscriptionCheck.remainingReports,
      });
      
      return createErrorResponse(
        subscriptionCheck.error || "Subscription validation failed.",
        getHttpStatusForSubscriptionError(subscriptionCheck.code)
      );
    }

    ctx.info("Subscription check passed", {
      remaining_reports: subscriptionCheck.remainingReports,
      subscription_reports: subscriptionCheck.subscriptionReports,
      block_reports: subscriptionCheck.blockReports,
      has_active_subscription: subscriptionCheck.hasActiveSubscription,
    });

    // 4. Generate a temporary ID for immediate response
    const tempRequestId = `req-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 11)}`;

    ctx.info("Processing request in background", {
      temp_request_id: tempRequestId,
    });

    // 5. Route to handler in background - let it process asynchronously
    runInBackground(async () => {
      try {
        ctx.info("Background processing started", {
          temp_request_id: tempRequestId,
        });
        
        const response = await routeRequest(payload, ctx);
        
        ctx.logSuccess({ 
          status: response.status,
          temp_request_id: tempRequestId,
        });
        
        ctx.info("Background processing completed successfully", {
          temp_request_id: tempRequestId,
          response_status: response.status,
        });
      } catch (error) {
        ctx.error("Background processing failed", {
          temp_request_id: tempRequestId,
          error: (error as Error).message,
          stack: (error as Error).stack,
        });
      }
    });

    // 6. Return immediate response - request accepted for processing
    ctx.info("Returning immediate acceptance response");
    const immediateResponse = createJsonResponse(
      {
        success: true,
        message: "Request accepted and processing in background",
        requestId: tempRequestId,
        status: "processing",
        subscription: {
          remaining_reports: subscriptionCheck.remainingReports,
          subscription_reports: subscriptionCheck.subscriptionReports,
          block_reports: subscriptionCheck.blockReports,
        },
      },
      HTTP_STATUS.ACCEPTED
    );

    // Add CORS headers to response
    const headers = new Headers(immediateResponse.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set(
      "Access-Control-Allow-Headers",
      "authorization, x-client-info, apikey, content-type"
    );

    return new Response(immediateResponse.body, {
      status: immediateResponse.status,
      statusText: immediateResponse.statusText,
      headers,
    });
  } catch (error) {
    ctx.error("Unhandled error in request pipeline", {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });

    let errorResponse: Response;

    // Respond to known parsing/validation errors with 400
    if (
      (error as Error).message.includes("Request body") ||
      (error as Error).message.includes("Invalid JSON")
    ) {
      ctx.logError((error as Error).message);
      errorResponse = createErrorResponse(
        (error as Error).message,
        HTTP_STATUS.BAD_REQUEST
      );
    } else {
      // Generic fallback for all other unexpected errors
      ctx.logError("Internal server error");
      errorResponse = createErrorResponse(
        "Internal server error.",
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      );
    }

    // Add CORS headers to error response
    const headers = new Headers(errorResponse.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set(
      "Access-Control-Allow-Headers",
      "authorization, x-client-info, apikey, content-type"
    );

    return new Response(errorResponse.body, {
      status: errorResponse.status,
      statusText: errorResponse.statusText,
      headers,
    });
  }
});