import { Request, Response, NextFunction } from "npm:express@4.18.2";
import { createAuthClient } from "../../shared/database-service.ts";
import { HTTP_STATUS, logError, logInfo, logDebug } from "../utils/logger.ts";

/**
 * Authentication middleware
 * Validates JWT token and attaches user info to request
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const { requestId } = req;

  try {
    logDebug(requestId, "Authenticating user from JWT");

    // Get authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      logError(requestId, "Missing authorization header");
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        error: "Missing authorization header.",
      });
    }

    // Extract token from "Bearer <token>" format
    const token = authHeader.replace("Bearer ", "");

    // Create Supabase auth client
    const supabase = createAuthClient();

    // Validate JWT token and get user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      logError(requestId, "Authentication failed", {
        error: authError?.message || "Invalid token",
      });
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        error: authError?.message || "Authentication failed.",
      });
    }

    logInfo(requestId, "User authenticated successfully", {
      user_id: "[PRESENT]",
      source: "jwt",
    });

    // Attach user info to request for use in routes
    (req as any).user = user;
    (req as any).userId = user.id;

    next();
  } catch (error) {
    const { message, stack } = error as Error;
    logError(requestId, "Authentication middleware error", {
      error: message,
      stack,
    });

    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      error: "Authentication error",
    });
  }
}
