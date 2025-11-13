import { supabase } from "../config/supabase.config.ts";
import { logInfo, logError, logDebug } from "../utils/logger.ts";
import type { N8nAppraisalResponse } from "../types/index.ts";

/**
 * Save report to database after successful n8n processing
 */
export async function saveReportToDatabase(
  inspectionId: string,
  reportData: N8nAppraisalResponse,
  requestId: string
): Promise<{ success: boolean; reportId?: string; error?: string }> {
  try {
    logDebug(requestId, "Saving report to database", {
      inspection_id: inspectionId,
      has_html_report: !!reportData.html_report,
    });

    // Extract summary text from report data
    const summary = buildSummaryText(reportData);

    // Prepare report record
    const reportRecord = {
      inspection_id: inspectionId,
      summary: summary,
      summary_json: reportData, // Save entire n8n response
      ai_model: "n8n_workflow", // Could be extracted from response if available
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    logDebug(requestId, "Inserting report record", {
      inspection_id: inspectionId,
      summary_length: summary.length,
    });

    const { data, error } = await supabase
      .from("reports")
      .insert(reportRecord)
      .select("id")
      .single();

    if (error) {
      logError(requestId, "Failed to save report to database", {
        error: error.message,
        code: error.code,
        inspection_id: inspectionId,
      });
      return { success: false, error: error.message };
    }

    logInfo(requestId, "Report saved successfully to database", {
      report_id: data.id,
      inspection_id: inspectionId,
    });

    return { success: true, reportId: data.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(requestId, "Exception while saving report", {
      error: message,
      inspection_id: inspectionId,
    });
    return { success: false, error: message };
  }
}

/**
 * Build human-readable summary text from report data
 */
function buildSummaryText(reportData: N8nAppraisalResponse): string {
  const parts: string[] = [];

  // Vehicle information
  if (reportData.vehicle) {
    const { year, make, model, trim } = reportData.vehicle;
    const trimText = trim && trim !== "Not specified" ? ` ${trim}` : "";
    parts.push(`${year} ${make} ${model}${trimText}`);
  }

  // VIN
  if (reportData.vin) {
    parts.push(`VIN: ${reportData.vin}`);
  }

  // Mileage
  if (reportData.valuation?.subject_mileage) {
    parts.push(`${reportData.valuation.subject_mileage.toLocaleString()} miles`);
  }

  // Condition score and damage
  if (reportData.condition) {
    const { score, damage_count } = reportData.condition;
    const conditionText = `Condition: ${score}/5.0`;
    const damageText = damage_count ? ` (${damage_count} issue${damage_count > 1 ? 's' : ''})` : "";
    parts.push(conditionText + damageText);
  }

  // Valuation summary
  if (reportData.valuation) {
    const { market_value, wholesale_value, recon_total, data_confidence } = reportData.valuation;
    
    if (market_value > 0) {
      parts.push(`Market: $${market_value.toLocaleString()}`);
    }
    
    if (wholesale_value > 0) {
      parts.push(`Wholesale: $${wholesale_value.toLocaleString()}`);
    }
    
    if (recon_total > 0) {
      parts.push(`Recon: $${recon_total.toLocaleString()}`);
    }
    
    if (data_confidence && data_confidence !== "none") {
      parts.push(`Confidence: ${data_confidence}`);
    }
  }

  // Recon items count
  if (reportData.recon_items && reportData.recon_items.length > 0) {
    parts.push(`${reportData.recon_items.length} repair item${reportData.recon_items.length > 1 ? 's' : ''}`);
  }

  // Images analyzed
  if (reportData.images?.analyzed) {
    parts.push(`${reportData.images.analyzed} image${reportData.images.analyzed > 1 ? 's' : ''} analyzed`);
  }

  // Processing info
  if (reportData.processing_time_seconds) {
    parts.push(`${reportData.processing_time_seconds}s processing`);
  }

  // Warnings
  if (reportData.warnings?.has_validation_warnings) {
    const warningCount = reportData.warnings.obdii_validation_issues || 0;
    if (warningCount > 0) {
      parts.push(`⚠️ ${warningCount} warning${warningCount > 1 ? 's' : ''}`);
    }
  }

  return parts.length > 0
    ? parts.join(" • ")
    : "Appraisal report generated successfully";
}

/**
 * Update inspection status after report is saved
 */
export async function updateInspectionStatus(
  inspectionId: string,
  status: string,
  requestId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    logDebug(requestId, "Updating inspection status", {
      inspection_id: inspectionId,
      new_status: status,
    });

    const { error } = await supabase
      .from("inspections")
      .update({
        status: status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", inspectionId);

    if (error) {
      logError(requestId, "Failed to update inspection status", {
        error: error.message,
        inspection_id: inspectionId,
      });
      return { success: false, error: error.message };
    }

    logInfo(requestId, "Inspection status updated successfully", {
      inspection_id: inspectionId,
      status,
    });

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(requestId, "Exception while updating inspection status", {
      error: message,
      inspection_id: inspectionId,
    });
    return { success: false, error: message };
  }
}

