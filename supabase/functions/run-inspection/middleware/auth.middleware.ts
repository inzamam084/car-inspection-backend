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
  const requestId = (req as any).requestId;

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
    logError(requestId, "Authentication middleware error", {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });

    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      error: "Authentication error",
    });
  }
}

/**
 * Optional authentication middleware
 * Attempts to authenticate but doesn't fail if no token provided
 * Useful for endpoints that work for both authenticated and anonymous users
 */
export async function optionalAuthMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  const requestId = (req as any).requestId;

  try {
    // Get authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      logDebug(requestId, "No authorization header provided (optional auth)");
      // Continue without authentication
      next();
      return;
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
      logDebug(requestId, "Optional authentication failed", {
        error: authError?.message || "Invalid token",
      });
      // Continue without authentication (optional)
      next();
      return;
    }

    logInfo(requestId, "User authenticated successfully (optional)", {
      user_id: "[PRESENT]",
      source: "jwt",
    });

    // Attach user info to request
    (req as any).user = user;
    (req as any).userId = user.id;

    next();
  } catch (error) {
    logError(requestId, "Optional authentication middleware error", {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });

    // Continue without authentication on error (optional)
    next();
  }
}
