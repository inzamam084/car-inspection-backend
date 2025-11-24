import { Router, Request, Response } from "npm:express@4.18.2";
import { HTTP_STATUS, logInfo, logError } from "../utils/logger.ts";
import { pollN8nAndUpdateInspections } from "../services/cron.service.ts";
import { generateRequestId } from "../utils/logger.ts";

const router = Router();

/**
 * POST /run-inspection/n8n/poll
 * Trigger manual N8N polling (for cron job)
 * No authentication required (called by pg_cron from server)
 */
router.post("/poll", async (req: Request, res: Response) => {
  const requestId = generateRequestId();

  try {
    logInfo(requestId, "Manual N8N polling triggered");

    const result = await pollN8nAndUpdateInspections(requestId);

    return res.status(HTTP_STATUS.OK).json({
      success: result.success,
      processed: result.processed,
      timed_out: result.timedOut,
      errors: result.errors,
      details: result.details,
    });
  } catch (error) {
    const { message, stack } = error as Error;
    logError(requestId, "Error in manual polling", {
      error: message,
      stack,
    });

    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      error: "Internal server error",
      message,
    });
  }
});

export default router;
