import { Request, Response, NextFunction } from "npm:express@4.18.2";
import { generateRequestId, logInfo } from "../utils/logger.ts";

/**
 * Logging middleware
 * Generates request ID and logs incoming requests
 */
export function loggingMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  const requestId = generateRequestId();
  // Attach requestId to request object for use in routes
  (req as any).requestId = requestId;

  logInfo(requestId, "Request received", {
    url: req.url,
    method: req.method,
    path: req.path,
    remote_addr: req.ip,
  });

  next();
}

