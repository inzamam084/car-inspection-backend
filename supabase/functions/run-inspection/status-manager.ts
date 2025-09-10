import { supabase } from "./config.ts";

/**
 * Centralized status management for inspections
 */

export type InspectionStatus =
  | "pending"
  | "processing"
  | "analyzing"
  | "completed"
  | "failed"
  | "done";

export class StatusManager {
  /**
   * Update inspection status with error handling and logging
   */
  static async updateStatus(
    inspectionId: string,
    status: InspectionStatus
  ): Promise<void> {
    try {
      console.log(`Updating inspection ${inspectionId} status to: ${status}`);

      const { error } = await supabase
        .from("inspections")
        .update({ status })
        .eq("id", inspectionId);

      if (error) {
        console.error(
          `Failed to update status for inspection ${inspectionId}:`,
          error
        );
        throw error;
      }

      console.log(
        `Successfully updated inspection ${inspectionId} to status: ${status}`
      );
    } catch (error) {
      console.error(`Error updating inspection status:`, error);
      throw error;
    }
  }

  /**
   * Update status with additional fields
   */
  static async updateStatusWithFields(
    inspectionId: string,
    status: InspectionStatus,
    additionalFields: Record<string, any> = {}
  ): Promise<void> {
    try {
      console.log(
        `Updating inspection ${inspectionId} status to: ${status} with additional fields`
      );

      const updateData = { status, ...additionalFields };

      const { error } = await supabase
        .from("inspections")
        .update(updateData)
        .eq("id", inspectionId);

      if (error) {
        console.error(`Failed to update inspection ${inspectionId}:`, error);
        throw error;
      }

      console.log(`Successfully updated inspection ${inspectionId}`);
    } catch (error) {
      console.error(`Error updating inspection:`, error);
      throw error;
    }
  }

  /**
   * Mark inspection as failed with optional error message
   */
  static async markAsFailed(
    inspectionId: string,
    errorMessage?: string
  ): Promise<void> {
    const additionalFields = errorMessage
      ? { error_message: errorMessage }
      : {};
    await this.updateStatusWithFields(inspectionId, "failed", additionalFields);
  }
}
