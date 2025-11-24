import { Router, Request, Response } from "npm:express@4.18.2";
import { HTTP_STATUS, logInfo, logError, logDebug } from "../utils/logger.ts";
import { generateRequestId } from "../utils/logger.ts";
import { supabase } from "../config/supabase.config.ts";

const router = Router();

// Get SMTP2GO API key from environment
const SMTP2GO_API_KEY = Deno.env.get("SMTP2GO_API_KEY");
const FRONTEND_URL = Deno.env.get("FRONTEND_URL") || "https://app.fixpilot.co";

/**
 * POST /run-inspection/email/send
 * Trigger email notification for inspection completion/failure
 * Called by database trigger when inspection status changes to done/failed
 */
router.post("/send", async (req: Request, res: Response) => {
  const requestId = generateRequestId();

  try {
    const { inspection_id, status } = req.body;

    if (!inspection_id || !status) {
      logError(requestId, "Missing required fields", {
        has_inspection_id: !!inspection_id,
        has_status: !!status,
      });
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: "inspection_id and status are required",
      });
    }

    // Validate status is done or failed
    if (status !== "done" && status !== "failed") {
      logError(requestId, "Invalid status for email", { status });
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: "Status must be 'done' or 'failed'",
      });
    }

    logInfo(requestId, "Email notification triggered", {
      inspection_id,
      status,
    });

    // Fetch inspection details including user info
    const { data: inspection, error: fetchError } = await supabase
      .from("inspections")
      .select(`
        id,
        vin,
        status,
        error_message,
        created_at,
        users (
          id,
          email,
          full_name
        ),
        reports (
          id,
          html_report
        )
      `)
      .eq("id", inspection_id)
      .single();

    if (fetchError || !inspection) {
      logError(requestId, "Failed to fetch inspection", {
        inspection_id,
        error: fetchError?.message,
      });
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        error: "Inspection not found",
      });
    }

    const user = inspection.users as { id: string; email: string; full_name: string } | null;
    const report = (inspection.reports as Array<{ id: string; html_report: string }> | null)?.[0];

    if (!user || !user.email) {
      logError(requestId, "User email not found", { inspection_id });
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: "User email not found",
      });
    }

    // Check if SMTP2GO is configured
    if (!SMTP2GO_API_KEY) {
      logError(requestId, "SMTP2GO_API_KEY not configured");
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: "Email service not configured",
      });
    }

    logInfo(requestId, "Sending email notification", {
      inspection_id,
      user_email: user.email,
      status,
      has_report: !!report,
    });

    // Prepare email content based on status
    // Extract user name from full_name or email
    const userName = user.full_name || user.email.split('@')[0];
    const subject = status === "done"
      ? `Your Car Inspection Report is Ready - VIN: ${inspection.vin}`
      : `Car Inspection Failed - VIN: ${inspection.vin}`;

    let htmlBody = "";

    if (status === "done") {
      // Success email template
      const reportUrl = report?.id
        ? `${FRONTEND_URL}/report/${report.id}`
        : `${FRONTEND_URL}/inspections/${inspection_id}`;

      htmlBody = `
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; padding: 20px;">
  <p>Hi ${userName},</p>

  <p>Your car inspection report for VIN: <strong>${inspection.vin}</strong> is ready.</p>

  <p><a href="${reportUrl}" style="color: #007bff;">View Your Report</a></p>

  <p>Best regards,<br>The FixPilot Team</p>

  <p style="font-size: 12px; color: #666;">Need help? Contact <a href="mailto:support@fixpilot.co">support@fixpilot.co</a></p>
</body>
</html>
`;
    } else {
      // Failed email template
      const errorMessage = inspection.error_message || "An unexpected error occurred during processing";

      htmlBody = `
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; padding: 20px;">
  <p>Hi ${userName},</p>

  <p>We encountered an issue while processing your car inspection for VIN: <strong>${inspection.vin}</strong>.</p>

  <p style="color: #666;"><strong>Error:</strong> ${errorMessage}</p>

  <p>Our team has been notified. Please contact support for assistance.</p>

  <p><a href="${FRONTEND_URL}/dashboard/reports" style="color: #007bff;">Go to Dashboard</a></p>

  <p>Best regards,<br>The FixPilot Team</p>

  <p style="font-size: 12px; color: #666;">Need help? Contact <a href="mailto:support@fixpilot.co">support@fixpilot.co</a></p>
</body>
</html>
`;
    }

    // Send email via SMTP2GO
    const emailPayload = {
      api_key: SMTP2GO_API_KEY,
      to: [user.email],
      sender: '"FixPilot" <noreply@fixpilot.co>',
      subject: subject,
      html_body: htmlBody,
    };

    logDebug(requestId, "Sending email via SMTP2GO", {
      inspection_id,
      to: user.email,
      subject,
    });

    const emailResponse = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Smtp2go-Api-Key": SMTP2GO_API_KEY,
      },
      body: JSON.stringify(emailPayload),
    });

    if (!emailResponse.ok) {
      const errorData = await emailResponse.text();
      logError(requestId, "SMTP2GO API error", {
        status: emailResponse.status,
        error: errorData,
        inspection_id,
      });
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: "Failed to send email",
        details: `SMTP2GO API error: ${emailResponse.status}`,
      });
    }

    const emailResult = await emailResponse.json();

    if (!emailResult.data || emailResult.data.succeeded === 0) {
      const errorMsg = emailResult.data?.error || "Failed to send email via SMTP2GO";
      logError(requestId, "Email sending failed", {
        error: errorMsg,
        inspection_id,
      });
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        error: "Failed to send email",
        details: errorMsg,
      });
    }

    logInfo(requestId, "Email sent successfully", {
      inspection_id,
      email_id: emailResult.request_id,
      user_email: user.email,
      status,
    });

    // Return success response
    return res.status(HTTP_STATUS.OK).json({
      success: true,
      message: "Email notification sent successfully",
      inspection_id,
      user_email: user.email,
      status,
      email_id: emailResult.request_id,
    });

  } catch (error) {
    const { message, stack } = error as Error;
    logError(requestId, "Error in email notification", {
      error: message,
      stack,
    });

    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      error: "Internal server error",
      message,
    });
  }
});

export default router;
