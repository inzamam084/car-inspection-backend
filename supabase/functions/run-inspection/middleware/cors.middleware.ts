import { Request, Response, NextFunction } from "npm:express@4.18.2";

/**
 * CORS middleware
 * Handles Cross-Origin Resource Sharing headers and preflight requests
 */
export function corsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "authorization, x-client-info, apikey, content-type"
  );
  res.header("Access-Control-Allow-Methods", "POST, GET, OPTIONS");

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    return res.status(200).send("ok");
  }

  next();
}

