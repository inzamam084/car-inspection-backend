import { Request, Response, NextFunction } from "npm:express@4.18.2";
import { HTTP_STATUS, logError } from "../utils/logger.ts";

/**
 * 404 handler
 * Must be registered before global error handler
 */
export function notFoundHandler(req: Request, res: Response) {
  const requestId = (req as any).requestId;
  logError(requestId, "Route not found", {
    path: req.path,
    method: req.method,
  });

  res.status(404).json({
    error: "Route not found",
    path: req.path,
    availableEndpoints: [
      "POST /run-inspection",
    ],
  });
}

/**
 * Global error handler
 * Catches all unhandled errors
 */
export function globalErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  const requestId = (req as any).requestId || "unknown";
  logError(requestId, "Express error handler triggered", {
    error: err.message,
    stack: err.stack,
  });

  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    error: "Internal server error",
  });
}

