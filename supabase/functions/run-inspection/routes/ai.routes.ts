import { Router, Request, Response } from "npm:express@4.18.2";
import { HTTP_STATUS, logError, logInfo } from "../utils/logger.ts";
import { authMiddleware } from "../middleware/auth.middleware.ts";
import {
  generateFiltersWithGemini,
  rankListingsWithGemini,
} from "../services/gemini.service.ts";
import type {
  GenerateFiltersRequest,
  RankListingsRequest,
} from "../services/gemini.service.ts";

const router = Router();

/**
 * POST /run-inspection/ai/generate-filters
 * Generate search filters from natural language description using Gemini AI
 */
router.post(
  "/generate-filters",
  authMiddleware,
  async (req: Request, res: Response) => {
    const { requestId, userId } = req as {
      requestId: string;
      userId: string;
    };

    try {
      const { description, platformName, availableFilters } =
        req.body as GenerateFiltersRequest;

      logInfo(requestId, "Generate filters request", {
        user_id: "[PRESENT]",
        platform: platformName,
      });

      // Validate request body
      if (!description || typeof description !== "string") {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: "Missing or invalid 'description' field",
        });
      }

      if (!platformName || typeof platformName !== "string") {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: "Missing or invalid 'platformName' field",
        });
      }

      if (
        !availableFilters ||
        typeof availableFilters !== "object" ||
        Object.keys(availableFilters).length === 0
      ) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: "Missing or invalid 'availableFilters' field",
        });
      }

      // Call Gemini service
      const result = await generateFiltersWithGemini(
        {
          description,
          platformName,
          availableFilters,
        },
        requestId
      );

      if (!result.success) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: result.error,
        });
      }

      logInfo(requestId, "Filters generated successfully");

      return res.status(HTTP_STATUS.OK).json({
        success: true,
        filters: result.filters,
      });
    } catch (error) {
      const { message, stack } = error as Error;
      logError(requestId, "Unhandled error in generate-filters", {
        error: message,
        stack,
      });

      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: "Internal server error while generating filters",
      });
    }
  }
);

/**
 * POST /run-inspection/ai/rank-listings
 * Rank scraped listings based on user description using Gemini AI
 */
router.post(
  "/rank-listings",
  authMiddleware,
  async (req: Request, res: Response) => {
    const { requestId, userId } = req as {
      requestId: string;
      userId: string;
    };

    try {
      const { description, listings } = req.body as RankListingsRequest;

      logInfo(requestId, "Rank listings request", {
        user_id: "[PRESENT]",
        listingCount: listings?.length || 0,
      });

      // Validate request body
      if (!description || typeof description !== "string") {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: "Missing or invalid 'description' field",
        });
      }

      if (!Array.isArray(listings) || listings.length === 0) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: "Missing or invalid 'listings' field (must be non-empty array)",
        });
      }

      // Call Gemini service
      const result = await rankListingsWithGemini(
        {
          description,
          listings,
        },
        requestId
      );

      if (!result.success) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: result.error,
        });
      }

      logInfo(requestId, "Listings ranked successfully");

      return res.status(HTTP_STATUS.OK).json({
        success: true,
        rankedListings: result.rankedListings,
      });
    } catch (error) {
      const { message, stack } = error as Error;
      logError(requestId, "Unhandled error in rank-listings", {
        error: message,
        stack,
      });

      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: "Internal server error while ranking listings",
      });
    }
  }
);

export default router;
