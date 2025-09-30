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
async function callRunInspectionOldAPI(
  payload: any,
  ctx: RequestContext
): Promise<Response> {
  try {
    ctx.info("Token not available, calling run-inspection-old API");

    // Make HTTP request to run-inspection-old function
    const response = await fetch(
      `${SUPABASE_CONFIG.url}/functions/v1/run-inspection-old`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_CONFIG.serviceKey}`,
        },
        body: JSON.stringify(payload),
      }
    );

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
      has_token: "token" in (payload as any),
      has_vehicle_data:
        "vehicleData" in (payload as any) ||
        "gallery_images" in (payload as any),
    });

    // 2. Authenticate User from JWT or Token
    let userId: string;
    const token = (payload as any).token;

    if (token) {
      // Token-based authentication
      ctx.debug("Token provided, fetching user from shared_links");
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      // Query shared_links and join with shared_link_inspections
      const { data: sharedLink, error: tokenError } = await supabase
        .from("shared_links")
        .select(`
          created_by,
          status,
          expires_at,
          max_uses,
          current_uses,
          shared_link_inspections!inner(
            inspection_id
          )
        `)
        .eq("token", token)
        .single();

      if (tokenError || !sharedLink) {
        ctx.error("Invalid token", { error: tokenError?.message });
        ctx.logError("Invalid or expired token");
        return createErrorResponse("Invalid or expired token.", HTTP_STATUS.UNAUTHORIZED);
      }

      // Verify token status is active
      if (sharedLink.status !== "active") {
        ctx.error("Token is not active", { status: sharedLink.status });
        ctx.logError(`Token status is ${sharedLink.status}`);
        return createErrorResponse(
          `Token is ${sharedLink.status}. Please request a new link.`,
          HTTP_STATUS.FORBIDDEN
        );
      }

      // Verify token hasn't expired
      const expiresAt = new Date(sharedLink.expires_at);
      if (expiresAt < new Date()) {
        ctx.error("Token has expired", { expires_at: sharedLink.expires_at });
        ctx.logError("Token has expired");
        
        // Update token status to expired
        await supabase
          .from("shared_links")
          .update({ status: "expired" })
          .eq("token", token);
        
        return createErrorResponse("Token has expired.", HTTP_STATUS.FORBIDDEN);
      }

      // Verify usage limits
      if (sharedLink.current_uses >= sharedLink.max_uses) {
        ctx.error("Token usage limit exceeded", {
          current_uses: sharedLink.current_uses,
          max_uses: sharedLink.max_uses,
        });
        ctx.logError("Token usage limit exceeded");
        
        // Update token status to used
        await supabase
          .from("shared_links")
          .update({ status: "used" })
          .eq("token", token);
        
        return createErrorResponse("Token usage limit exceeded.", HTTP_STATUS.FORBIDDEN);
      }

      // Verify inspection_id matches one of the linked inspections
      const inspectionId = (payload as any).inspection_id;
      const linkedInspections = sharedLink.shared_link_inspections || [];
      const isInspectionLinked = linkedInspections.some(
        (link: any) => link.inspection_id === inspectionId
      );

      if (!isInspectionLinked) {
        ctx.error("Inspection not linked to this token", {
          token_inspection_count: linkedInspections.length,
          requested_inspection: inspectionId,
        });
        ctx.logError("Token does not have access to this inspection");
        return createErrorResponse(
          "This token does not have access to the requested inspection.",
          HTTP_STATUS.FORBIDDEN
        );
      }

      // Update token usage tracking
      const updateData: any = {
        current_uses: sharedLink.current_uses + 1,
        last_accessed_at: new Date().toISOString(),
      };

      // Set first_accessed_at if this is the first use
      if (!sharedLink.current_uses || sharedLink.current_uses === 0) {
        updateData.first_accessed_at = new Date().toISOString();
      }

      // Update status to 'used' if this use reaches max_uses
      if (sharedLink.current_uses + 1 >= sharedLink.max_uses) {
        updateData.status = "used";
      }

      await supabase
        .from("shared_links")
        .update(updateData)
        .eq("token", token);

      userId = sharedLink.created_by;
      ctx.setUser(userId);
      ctx.info("Token authenticated successfully", {
        user_id: "[PRESENT]",
        source: "token",
        uses: `${sharedLink.current_uses + 1}/${sharedLink.max_uses}`,
      });
    } else {
      // JWT-based authentication
      ctx.debug("Authenticating user from JWT");
      const { user, error: authError } = await authenticateUser(req);
      if (authError || !user) {
        ctx.warn("Authentication failed, calling run-inspection-old API", authError);
        return await callRunInspectionOldAPI(payload, ctx);
      }
      userId = user.id;
      ctx.setUser(userId);
      ctx.info("User authenticated successfully", { user_id: "[PRESENT]", source: "jwt" });
    }

    // 3. Perform Subscription and Usage Check
    ctx.debug("Performing subscription and usage check");
    const subscriptionCheck = await withSubscriptionCheck(userId, {
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

    ctx.info("Payload ", payload);

    // return;

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
