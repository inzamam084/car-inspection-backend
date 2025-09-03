import { supabase } from "./config.ts";
import { createDatabaseService } from "../shared/database-service.ts";
import type { ExtensionVehicleData, InspectionStatus } from "./schemas.ts";
import { RequestContext } from "./logging.ts";

// Initialize optimized database service
const dbService = createDatabaseService();

/**
 * Centralized database operations for run-inspection
 */
export class Database {
  /**
   * Fetch inspection details by ID
   */
  static async fetchInspectionById(inspectionId: string, ctx: RequestContext) {
    ctx.debug("Fetching inspection details from database", {
      inspection_id: inspectionId,
    });

    const { data: inspection, error } = await supabase
      .from("inspections")
      .select("id, vin, email, type, url")
      .eq("id", inspectionId)
      .single();

    if (error) {
      ctx.error("Failed to fetch inspection details", {
        inspection_id: inspectionId,
        error: error.message,
      });
    } else {
      ctx.info("Inspection details retrieved successfully", {
        inspection_type: inspection?.type,
        has_vin: !!inspection?.vin,
        has_url: !!inspection?.url,
      });
    }

    return { data: inspection, error };
  }

  /**
   * Batch fetch all inspection data in a single query
   */
  static async batchFetchInspectionData(inspectionId: string) {
    return await dbService.batchFetchInspectionData(inspectionId);
  }

  /**
   * Update inspection status
   */
  static async updateInspectionStatus(
    inspectionId: string,
    status: InspectionStatus,
    additionalData: any = {}
  ) {
    return await dbService.updateInspectionStatus(
      inspectionId,
      status,
      additionalData
    );
  }

  /**
   * Update inspection status with additional fields
   */
  static async updateInspectionStatusWithFields(
    inspectionId: string,
    status: InspectionStatus,
    additionalFields: Record<string, any> = {},
    ctx: RequestContext
  ) {
    try {
      ctx.debug(
        `Updating inspection ${inspectionId} status to: ${status} with additional fields`
      );

      const updateData = { status, ...additionalFields };

      const { error } = await supabase
        .from("inspections")
        .update(updateData)
        .eq("id", inspectionId);

      if (error) {
        ctx.error(`Failed to update inspection ${inspectionId}`, {
          error: error.message,
        });
        throw error;
      }

      ctx.info(`Successfully updated inspection ${inspectionId}`, { status });
      return { data: { id: inspectionId, status }, error: null };
    } catch (error) {
      ctx.error(`Error updating inspection`, {
        error: (error as Error).message,
      });
      return { data: null, error };
    }
  }

  /**
   * Mark inspection as failed with optional error message
   */
  static async markInspectionAsFailed(
    inspectionId: string,
    errorMessage: string | undefined,
    ctx: RequestContext
  ) {
    const additionalFields = errorMessage
      ? { error_message: errorMessage }
      : {};
    return await this.updateInspectionStatusWithFields(
      inspectionId,
      "failed",
      additionalFields,
      ctx
    );
  }

  /**
   * Create inspection from vehicle data (extension)
   */
  static async createInspectionFromVehicleData(
    vehicleData: ExtensionVehicleData,
    extractedVehicleData: any = null,
    ctx: RequestContext
  ): Promise<{
    success: boolean;
    inspectionId?: string;
    error?: string;
  }> {
    try {
      // Use extracted data as primary source, fall back to vehicleData
      const vin = extractedVehicleData?.Vin || vehicleData.vin;
      const mileage = extractedVehicleData?.Mileage?.toString() || vehicleData.mileage;
      
      // Extract relevant data for inspection
      const inspectionData = {
        email: vehicleData.email || "extension@copart.com", // Default email if not provided
        user_id: vehicleData.user_id || null, // Optional user ID
        vin: vin,
        mileage: mileage,
        status: "pending",
        type: "extension", // Mark as extension-sourced
        url: vehicleData.listing_url,
        vehicle_details: extractedVehicleData, // Store complete extracted data as JSONB
        created_at: new Date().toISOString(),
      };

      ctx.debug("Creating inspection with data", {
        has_email: !!inspectionData.email,
        has_user_id: !!inspectionData.user_id,
        has_vin: !!inspectionData.vin,
        has_mileage: !!inspectionData.mileage,
        type: inspectionData.type,
        has_url: !!inspectionData.url,
      });

      const { data, error } = await supabase
        .from("inspections")
        .insert(inspectionData)
        .select("id")
        .single();

      if (error) {
        ctx.error("Error creating inspection", { error: error.message });
        return {
          success: false,
          error: error.message,
        };
      }

      if (!data?.id) {
        ctx.error("No inspection ID returned from database");
        return {
          success: false,
          error: "No inspection ID returned",
        };
      }

      // Log additional vehicle metadata for reference
      ctx.debug("Additional vehicle metadata logged", {
        make: vehicleData.make,
        model: vehicleData.model,
        year: vehicleData.year,
        has_price: !!vehicleData.price,
        has_seller_name: !!vehicleData.seller_name,
        has_seller_phone: !!vehicleData.seller_phone,
        has_description: !!vehicleData.description,
        scraped_at: vehicleData.scraped_at,
      });

      return {
        success: true,
        inspectionId: data.id,
      };
    } catch (error) {
      ctx.error("Unexpected error creating inspection", {
        error: (error as Error).message,
      });
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Batch create processing jobs
   */
  static async batchCreateProcessingJobs(jobs: any[]) {
    return await dbService.batchCreateProcessingJobs(jobs);
  }

  /**
   * Batch fetch completed jobs for final report
   */
  static async batchFetchCompletedJobs(inspectionId: string) {
    return await dbService.batchFetchCompletedJobs(inspectionId);
  }

  /**
   * Get next pending job
   */
  static async getNextPendingJob(
    inspectionId: string,
    completedSequence: number
  ) {
    return await dbService.getNextPendingJob(inspectionId, completedSequence);
  }

  /**
   * Batch update converted paths for HEIC conversion
   */
  static async batchUpdateConvertedPaths(
    updates: Array<{
      table: "photos" | "obd2_codes" | "title_images";
      id: string;
      convertedPath: string;
    }>
  ) {
    return await dbService.batchUpdateConvertedPaths(updates);
  }

  /**
   * Update job with results
   */
  static async updateJobWithResults(
    jobId: string,
    updateData: {
      status: string;
      chunkResult?: any;
      cost?: number;
      totalTokens?: number;
      webSearchCount?: number;
      webSearchResults?: any[];
      errorMessage?: string;
    }
  ) {
    return await dbService.updateJobWithResults(jobId, updateData);
  }

  /**
   * Get final chunk analysis result
   */
  static async getFinalChunkResult(inspectionId: string) {
    return await dbService.getFinalChunkResult(inspectionId);
  }

  /**
   * Create or update report
   */
  static async createOrUpdateReport(inspectionId: string, reportData: any) {
    return await dbService.createOrUpdateReport(inspectionId, reportData);
  }

  /**
   * Get the underlying database service for advanced operations
   */
  static getDatabaseService() {
    return dbService;
  }

  /**
   * Get the underlying supabase client for direct access when needed
   */
  static getSupabaseClient() {
    return supabase;
  }
}

// Export the database class as default
export default Database;

// Also export individual functions for backward compatibility
export const {
  fetchInspectionById,
  batchFetchInspectionData,
  updateInspectionStatus,
  updateInspectionStatusWithFields,
  markInspectionAsFailed,
  createInspectionFromVehicleData,
  batchCreateProcessingJobs,
  batchFetchCompletedJobs,
  getNextPendingJob,
  batchUpdateConvertedPaths,
  updateJobWithResults,
  getFinalChunkResult,
  createOrUpdateReport,
  getDatabaseService,
  getSupabaseClient,
} = Database;
