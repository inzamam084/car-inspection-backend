import { Request, Response, NextFunction } from "npm:express@4.18.2";
import { detectRequestSource } from "../utils/request-validator.ts";
import { logInfo } from "../utils/logger.ts";

/**
 * Source detection middleware
 * Detects whether request is from website or Chrome extension
 * and attaches the source to the request object
 */
export function sourceDetectionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const { requestId } = req as { requestId: string };

  try {
    const source = detectRequestSource(req.body);

    logInfo(requestId, "Request source detected", { source });

    // Attach source to request for downstream middleware and handlers
    (req as any).source = source;

    next();
  } catch (error) {
    const { message } = error as Error;
    logInfo(requestId, "Failed to detect source, defaulting to website", {
      error: message,
    });

    // Default to website if detection fails
    (req as any).source = "website";
    next();
  }
}
