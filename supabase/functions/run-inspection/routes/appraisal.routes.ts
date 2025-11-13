import { Router, Request, Response } from "npm:express@4.18.2";
import { HTTP_STATUS, logInfo, logError, logDebug } from "../utils/logger.ts";
import { authMiddleware } from "../middleware/auth.middleware.ts";
import { subscriptionMiddleware } from "../middleware/subscription.middleware.ts";
import { runInBackground } from "../utils/background.ts";
import { processAppraisalInBackground } from "../services/appraisal.service.ts";
import {
  detectRequestSource,
  validateChromeExtensionPayload,
  validateWebsitePayload,
} from "../utils/request-validator.ts";
import {
  fetchInspectionData,
  buildImageUrls,
  formatObd2Codes,
} from "../services/inspection.service.ts";
import type {
  ChromeExtensionPayload,
  WebsitePayload,
  N8nAppraisalPayload,
} from "../types/index.ts";

const router = Router();

/**
 * Main appraisal endpoint
 * POST /run-inspection
 *
 * Supports two request sources:
 * 1. Chrome Extension: Full payload with VIN, image URLs, etc.
 * 2. Website: Only inspection_id (fetches data from Supabase)
 *
 * Requires: JWT authentication
 * Validates: Subscription/report availability
 * Processes: Request in background
 */
router.post(
  "/",
  authMiddleware, // 1. Authenticate user
  subscriptionMiddleware, // 2. Validate subscription/report availability
  async (req: Request, res: Response) => {
    const { requestId, userId } = req;

    try {
      // 1. Validate Request Body
      logDebug(requestId, "Validating request body");
      const payload = req.body;
       
      // 2. Detect request source
      const source = detectRequestSource(payload);
      logInfo(requestId, "Request source detected", {
        source,
        user_id: "[PRESENT]",
      });

      let n8nPayload: N8nAppraisalPayload;
      let appraisalId: string;

      // 3. Handle based on source
      if (source === "website") {
        // Website flow: Fetch data from Supabase
        const websitePayload = payload as WebsitePayload;

        // Validate website payload
        const validation = validateWebsitePayload(websitePayload, requestId);
        if (!validation.valid) {
          return res.status(HTTP_STATUS.BAD_REQUEST).json({
            error: "Invalid website payload",
            details: validation.errors,
          });
        }

        const { inspection_id } = websitePayload;
        appraisalId = inspection_id;

        // Fetch inspection data from database
        logInfo(requestId, "Fetching inspection data from database", {
          inspection_id,
        });

        const { data: inspectionData, error: fetchError } =
          await fetchInspectionData(inspection_id, requestId);

        if (fetchError || !inspectionData) {
          return res.status(HTTP_STATUS.NOT_FOUND).json({
            error: fetchError || "Inspection not found",
          });
        }

        // Check if inspection has required data
        if (!inspectionData.vin) {
          return res.status(HTTP_STATUS.BAD_REQUEST).json({
            error: "Inspection does not have VIN",
          });
        }

        if (!inspectionData.photos || inspectionData.photos.length === 0) {
          return res.status(HTTP_STATUS.BAD_REQUEST).json({
            error: "Inspection has no photos",
          });
        }

        if (inspectionData.photos.length < 3) {
          return res.status(HTTP_STATUS.BAD_REQUEST).json({
            error: "Inspection must have at least 3 photos for appraisal",
            photo_count: inspectionData.photos.length,
          });
        }

        // Build image URLs from photos
        const imageUrls = buildImageUrls(inspectionData.photos);

        // Build n8n payload
        n8nPayload = {
          vin: inspectionData.vin,
          mileage: inspectionData.mileage || undefined,
          obdii_codes: formatObd2Codes(inspectionData.obd2_codes) || undefined,
          notes: undefined, // Website doesn't have notes field
          image_urls: imageUrls,
          appraisal_id: inspection_id,
          image_count: imageUrls.length,
        };

        logInfo(requestId, "Built n8n payload from website request", {
          inspection_id,
          vin: n8nPayload.vin,
          image_count: n8nPayload.image_count,
        });
      } else {
        // Chrome Extension flow: Use payload as-is
        const chromePayload = payload as ChromeExtensionPayload;

        // Validate chrome extension payload
        const validation = validateChromeExtensionPayload(
          chromePayload,
          requestId
        );
        if (!validation.valid) {
          return res.status(HTTP_STATUS.BAD_REQUEST).json({
            error: "Invalid chrome extension payload",
            details: validation.errors,
          });
        }

        appraisalId = chromePayload.appraisal_id;

        // Use chrome extension payload directly
        n8nPayload = {
          vin: chromePayload.vin,
          mileage: chromePayload.mileage,
          obdii_codes: chromePayload.obdii_codes,
          notes: chromePayload.notes,
          image_urls: chromePayload.image_urls,
          appraisal_id: chromePayload.appraisal_id,
          image_count: chromePayload.image_count,
        };

        logInfo(requestId, "Using chrome extension payload", {
          appraisal_id: appraisalId,
          vin: n8nPayload.vin,
          image_count: n8nPayload.image_count,
        });
      }

      // 4. Start background processing
      logInfo(requestId, "Request accepted, processing in background", {
        appraisal_id: appraisalId,
        source,
        user_id: "[PRESENT]",
      });

      // Use EdgeRuntime.waitUntil for proper background execution
      runInBackground(async () => {
        await processAppraisalInBackground(
          n8nPayload,
          userId,
          appraisalId,
          requestId
        );
      });

      // 5. Return 202 Accepted immediately
      return res.status(HTTP_STATUS.ACCEPTED).json({
        message: "Request accepted and is being processed",
        appraisal_id: appraisalId,
        request_id: requestId,
        source,
        status: "processing",
      });
    } catch (error) {
      const { message, stack } = error as Error;

      logError(requestId, "Unhandled error in request pipeline", {
        error: message,
        stack,
      });

      // Generic fallback for all other unexpected errors
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: "Internal server error.",
      });
    }
  }
);

export default router;
