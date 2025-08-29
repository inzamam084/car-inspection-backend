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

// --- Main Server ---
serve(async (req: Request, connInfo: ConnInfo) => {
  const { remoteAddr } = connInfo;
  console.log(`Request received from ${remoteAddr.hostname}...`);

  try {
    // 1. Parse and Validate Request Body
    const payload = await parseRequestBody(req);

    // 2. Authenticate User from JWT
    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) {
      console.error("Authentication failed:", authError);
      return createErrorResponse(
        "Authentication required.",
        HTTP_STATUS.UNAUTHORIZED
      );
    }
    console.log(`Authenticated user: ${user.id}`);

    // 3. Perform Subscription and Usage Check
    const subscriptionCheck = await withSubscriptionCheck(user.id, {
      requireSubscription: true,
      checkUsageLimit: true,
      incrementUsage: true,
    });
    if (!subscriptionCheck.success) {
      console.error(
        `Subscription check failed for user ${user.id}: ${subscriptionCheck.error}`
      );
      const status = getStatusForSubscriptionError(subscriptionCheck.code);
      return createErrorResponse(
        subscriptionCheck.error || "Subscription validation failed.",
        status
      );
    }
    console.log(
      `Subscription check passed. Remaining reports: ${subscriptionCheck.remainingReports}`
    );

    // 4. Route to the correct business logic handler
    return await routeRequest(payload);
  } catch (error) {
    console.error("Unhandled error in request pipeline:", error.message);
    // Respond to known parsing/validation errors with 400
    if (
      error.message.includes("Request body") ||
      error.message.includes("Invalid JSON")
    ) {
      return createErrorResponse(error.message, HTTP_STATUS.BAD_REQUEST);
    }
    // Generic fallback for all other unexpected errors
    return createErrorResponse(
      "Internal server error.",
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    );
  }
});
