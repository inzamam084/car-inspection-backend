import { Router, Request, Response } from "npm:express@4.18.2";
import { HTTP_STATUS, logInfo, logError } from "../utils/logger.ts";
import { authMiddleware } from "../middleware/auth.middleware.ts";
import { subscriptionMiddleware } from "../middleware/subscription.middleware.ts";
import { runInBackground } from "../utils/background.ts";
import { processAppraisalInBackground } from "../services/appraisal.service.ts";
import {
  handleWebsiteRequest,
  handleChromeExtensionRequest,
} from "../services/request-handler.service.ts";
import { detectRequestSource } from "../utils/request-validator.ts";

const router = Router();

/**
 * POST /run-inspection
 * Main appraisal endpoint supporting Chrome Extension and Website requests
 */
router.post(
  "/",
  authMiddleware,
  subscriptionMiddleware,
  async (req: Request, res: Response) => {
    const { requestId, userId } = req as { requestId: string; userId: string };

    try {
      const source = detectRequestSource(req.body);
      logInfo(requestId, "Request source detected", { source });
      console.log("BODY ", req.body);

      // Process based on source
      const result =
        source === "website"
          ? await handleWebsiteRequest(req.body, requestId)
          : await handleChromeExtensionRequest(req.body, userId, requestId);

      if (!result.success) {
        return res.status(result.statusCode || HTTP_STATUS.BAD_REQUEST).json({
          error: result.error,
          details: result.details,
        });
      }

      console.log("Result ", result);

      // Start background processing
      runInBackground(async () => {
        await processAppraisalInBackground(
          result.n8nPayload!,
          userId,
          result.appraisalId!,
          requestId
        );
      });

      // Return 202 Accepted immediately
      return res.status(HTTP_STATUS.ACCEPTED).json({
        message: "Request accepted and is being processed",
        appraisal_id: result.appraisalId,
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

      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: "Internal server error.",
      });
    }
  }
);

export default router;
