import { runAnalysisInBackground, runScrapeThenAnalysis } from "./processor.ts";
import { processExtensionData } from "./extension-handler.ts";
import { Database } from "./database.ts";
import {
  createJsonResponse,
  createErrorResponse,
  HTTP_STATUS,
  runInBackground,
} from "./utils.ts";
import { RequestContext } from "./logging.ts";
import {
  getHttpStatusForSubscriptionError,
  withSubscriptionCheck,
} from "../shared/subscription-middleware.ts";

// --- Route Handlers ---

/**
 * Handles webhook payloads for existing inspections.
 * @param payload The webhook payload containing the inspection_id.
 * @param ctx The request context for logging.
 * @returns A Response object.
 */
export async function handleWebhookRequest(
  payload: { inspection_id: string },
  ctx: RequestContext
): Promise<Response> {
  const { inspection_id: inspectionId } = payload;
  ctx.setOperation("webhook_analysis");
  ctx.setInspection(inspectionId);
  ctx.info("Processing webhook analysis request", {
    inspection_id: inspectionId,
  });

  if (!inspectionId) {
    ctx.error("Missing required inspection_id parameter");
    return createErrorResponse(
      "`inspection_id` is required in request payload.",
      HTTP_STATUS.BAD_REQUEST
    );
  }

  // 🔒 Subscription check with inspectionId
  const subCheck = await withSubscriptionCheck(ctx.userId!, {
    requireSubscription: true,
    checkUsageLimit: true,
    trackUsage: true,
    inspectionId,
  });

  if (!subCheck.success) {
    return createErrorResponse(
      subCheck.error || "Subscription validation failed.",
      getHttpStatusForSubscriptionError(subCheck.code)
    );
  }

  const { data: inspection, error } = await Database.fetchInspectionById(
    inspectionId,
    ctx
  );

  if (error || !inspection) {
    return createErrorResponse(
      "Failed to fetch inspection details.",
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    );
  }

  // For type "detail", save VIN and mileage to vehicle_details before starting analysis
  if (inspection.type === "detail") {
    ctx.info(
      "Processing detail type inspection - saving VIN and mileage to vehicle_details"
    );

    // Prepare vehicle details with VIN and mileage
    const vehicleDetails: any = {};
    if (inspection.vin) {
      vehicleDetails.Vin = inspection.vin;
    }
    if (inspection.mileage) {
      vehicleDetails.Mileage = inspection.mileage;
    }

    // Update inspection with vehicle_details if we have VIN or mileage
    if (Object.keys(vehicleDetails).length > 0) {
      try {
        const { error: updateError } = await Database.getSupabaseClient()
          .from("inspections")
          .update({ vehicle_details: vehicleDetails })
          .eq("id", inspectionId);

        if (updateError) {
          ctx.error(
            "Failed to update vehicle_details for detail type inspection",
            {
              error: updateError.message,
            }
          );
        } else {
          ctx.info(
            "Successfully updated vehicle_details for detail type inspection",
            {
              vehicle_details: vehicleDetails,
            }
          );
        }
      } catch (error) {
        ctx.error("Error updating vehicle_details for detail type inspection", {
          error: (error as Error).message,
        });
      }
    }
  }

  // Decide which pipeline to invoke and run in the background
  if (inspection.type === "url") {
    ctx.info("Starting scrape-then-analysis pipeline in background");
    runInBackground(() => runScrapeThenAnalysis(inspection, ctx));
  } else {
    ctx.info("Starting analysis pipeline in background");
    runInBackground(() => runAnalysisInBackground(inspection.id, ctx));
  }

  return createJsonResponse(
    {
      success: true,
      message: "Analysis started in background",
      inspectionId,
      status: "processing",
    },
    HTTP_STATUS.ACCEPTED
  );
}

/**
 * Routes the request to the appropriate handler based on payload content.
 * @param payload The parsed request payload.
 * @param ctx The request context for logging.
 * @returns A promise resolving to a Response object.
 */
export async function routeRequest(
  payload: any,
  ctx: RequestContext
): Promise<Response> {
  ctx.debug("Routing request based on payload content");

  if (typeof payload !== "object" || payload === null) {
    ctx.error("Invalid payload format - not an object");
    return Promise.resolve(
      createErrorResponse(
        "Invalid payload format. Expected a JSON object.",
        HTTP_STATUS.BAD_REQUEST
      )
    );
  }

  // Route 1: Webhook for existing inspection
  if ("inspection_id" in payload) {
    ctx.debug("Routing to webhook handler");
    return handleWebhookRequest(payload, ctx);
  }

  // Route 2: Data from browser extension (two possible formats)
  if (
    "vehicleData" in payload ||
    ("gallery_images" in payload &&
      "make" in payload &&
      "model" in payload &&
      "year" in payload)
  ) {
    ctx.debug("Routing to extension handler");

    // Step 1: Pre-check subscription (without inspectionId yet)
    ctx.info("Pre-checking subscription before processing");
    const preCheck = await withSubscriptionCheck(ctx.userId!, {
      requireSubscription: true,
      checkUsageLimit: true,
      trackUsage: false, // can't track until inspection exists
    });

    if (!preCheck.success) {
      ctx.error("Subscription pre-check failed", {
        error: preCheck.error,
        code: preCheck.code,
      });
      return createErrorResponse(
        preCheck.error || "Subscription validation failed.",
        getHttpStatusForSubscriptionError(preCheck.code)
      );
    }

    ctx.info("Subscription pre-check passed, starting background processing");

    // Generate a temporary ID for immediate response to client
    const tempInspectionId = `temp-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 11)}`;

    // Step 2: Run everything in background (create inspection, extract data, upload images, track usage, run analysis)
    runInBackground(async () => {
      try {
        ctx.info("Background processing started", {
          temp_inspection_id: tempInspectionId,
        });

        // Process extension data → creates inspection + extracts data + uploads images
        const result = await processExtensionData(payload, ctx);

        if (!result.success || !result.inspectionId) {
          ctx.error("Extension processing failed in background", {
            temp_inspection_id: tempInspectionId,
            error: result.error,
          });
          return;
        }

        const inspectionId = result.inspectionId;
        ctx.info("Extension processing completed, tracking usage", {
          temp_inspection_id: tempInspectionId,
          actual_inspection_id: inspectionId,
        });

        // Step 3: Track usage now WITH real inspectionId
        const usageCheck = await withSubscriptionCheck(ctx.userId!, {
          requireSubscription: true,
          checkUsageLimit: true,
          trackUsage: true,
          inspectionId,
          hadHistory: false,
        });

        if (!usageCheck.success) {
          ctx.error("Usage tracking failed in background", {
            inspection_id: inspectionId,
            error: usageCheck.error,
            code: usageCheck.code,
          });
          // Note: At this point, inspection is already created and processing started
          // We log the error but don't fail the entire operation
          return;
        }

        ctx.info("Usage tracked successfully", {
          inspection_id: inspectionId,
          remaining_reports: usageCheck.remainingReports,
          usage_type: usageCheck.usageType,
        });
      } catch (error) {
        ctx.error("Unexpected error in background processing", {
          temp_inspection_id: tempInspectionId,
          error: (error as Error).message,
          stack: (error as Error).stack,
        });
      }
    });

    // Step 4: Return immediate response to client
    return createJsonResponse(
      {
        success: true,
        message: "Extension data processing started in background",
        inspectionId: tempInspectionId,
        status: "processing",
      },
      HTTP_STATUS.ACCEPTED
    );
  }

  // --- Fallback: Invalid format ---
  ctx.error("Invalid payload format - missing required fields");
  return createErrorResponse(
    "Invalid payload format. Expected `inspection_id` or `vehicleData` fields.",
    HTTP_STATUS.BAD_REQUEST
  );
}
