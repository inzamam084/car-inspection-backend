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
import { supabase } from "../config/supabase.config.ts";

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

      // Create initial search query record
      const { data: searchQuery, error: insertError } = await supabase
        .from("user_search_queries")
        .insert({
          user_id: userId,
          search_query: description,
          platform_name: platformName,
          status: "pending",
        })
        .select()
        .single();

      if (insertError) {
        logError(requestId, "Failed to create search query record", {
          error: insertError.message,
        });
      }

      // Call Gemini service
      const startTime = Date.now();
      const result = await generateFiltersWithGemini(
        {
          description,
          platformName,
          availableFilters,
        },
        requestId
      );
      const filterGenerationTime = Date.now() - startTime;

      if (!result.success) {
        // Update search query with error
        if (searchQuery) {
          await supabase
            .from("user_search_queries")
            .update({
              status: "failed",
              error_message: result.error,
              filter_generation_time_ms: filterGenerationTime,
            })
            .eq("id", searchQuery.id);
        }

        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: result.error,
        });
      }

      // Update search query with generated filters
      if (searchQuery) {
        await supabase
          .from("user_search_queries")
          .update({
            generated_filters: result.filters,
            status: "filters_generated",
            filter_generation_time_ms: filterGenerationTime,
          })
          .eq("id", searchQuery.id);
      }

      logInfo(requestId, "Filters generated successfully");

      return res.status(HTTP_STATUS.OK).json({
        success: true,
        filters: result.filters,
        searchQueryId: searchQuery?.id,
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
      const { description, listings, searchQueryId } = req.body as RankListingsRequest & {
        searchQueryId?: string;
      };

      logInfo(requestId, "Rank listings request", {
        user_id: "[PRESENT]",
        listingCount: listings?.length || 0,
        hasSearchQueryId: !!searchQueryId,
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

      // Update search query with scraped listings if searchQueryId provided
      if (searchQueryId) {
        await supabase
          .from("user_search_queries")
          .update({
            scraped_listings: listings,
            status: "listings_scraped",
          })
          .eq("id", searchQueryId);
      }

      // Call Gemini service
      const startTime = Date.now();
      const result = await rankListingsWithGemini(
        {
          description,
          listings,
        },
        requestId
      );
      const rankingTime = Date.now() - startTime;

      if (!result.success) {
        // Update search query with error
        if (searchQueryId) {
          await supabase
            .from("user_search_queries")
            .update({
              status: "failed",
              error_message: result.error,
              ranking_time_ms: rankingTime,
            })
            .eq("id", searchQueryId);
        }

        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          error: result.error,
        });
      }

      // Update search query with ranked listings
      if (searchQueryId) {
        await supabase
          .from("user_search_queries")
          .update({
            ranked_listings: result.rankedListings,
            status: "ranked",
            ranking_time_ms: rankingTime,
          })
          .eq("id", searchQueryId);
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
