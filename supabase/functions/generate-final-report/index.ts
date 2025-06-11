import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Base URL for the application
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") || "https://ourfixmate.vercel.app/";

// Function to generate PDF report
async function generatePDFReport(inspectionId: string, reportData: any, inspection: any, photos: any[], titleImages: any[]) {
  try {
    const pdfDoc = await PDFDocument.create();
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // CONSISTENT DESIGN SYSTEM
    const PAGE_WIDTH = 612;
    const PAGE_HEIGHT = 792;
    const MARGIN = 50;
    const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
    const FOOTER_HEIGHT = 60;
    const HEADER_HEIGHT = 100;

    // STANDARDIZED COLOR PALETTE
    const colors = {
      primary: rgb(0.059, 0.569, 0.478),
      success: rgb(0.059, 0.569, 0.478),
      warning: rgb(0.92, 0.6, 0.1),
      danger: rgb(0.8, 0.2, 0.2),
      text: rgb(0, 0, 0),
      textSecondary: rgb(0.4, 0.4, 0.4),
      textLight: rgb(0.6, 0.6, 0.6),
      background: rgb(1, 1, 1),
      backgroundLight: rgb(0.98, 0.98, 0.98),
      backgroundGray: rgb(0.95, 0.95, 0.95),
      border: rgb(0.8, 0.8, 0.8),
      borderLight: rgb(0.9, 0.9, 0.9),
      white: rgb(1, 1, 1),
    };

    // STANDARDIZED TYPOGRAPHY SYSTEM
    const typography = {
      title: { size: 20, font: helveticaBold },
      heading1: { size: 16, font: helveticaBold },
      heading2: { size: 14, font: helveticaBold },
      heading3: { size: 12, font: helveticaBold },
      body: { size: 10, font: helveticaFont },
      bodySmall: { size: 9, font: helveticaFont },
      caption: { size: 8, font: helveticaFont },
      label: { size: 10, font: helveticaFont },
      value: { size: 10, font: helveticaFont },
      header: { size: 16, font: helveticaBold },
      footer: { size: 8, font: helveticaFont },
    };

    // STANDARDIZED SPACING SYSTEM
    const spacing = {
      xs: 5,
      sm: 10,
      md: 15,
      lg: 20,
      xl: 25,
      xxl: 30,
      section: 40,
    };

    const summary = reportData.summary_json;
    const reportDate = new Date(reportData.created_at).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    // CONSISTENT PAGE HEADER FUNCTION
    const addPageWithHeader = (title: string) => {
      const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

      // Header background
      page.drawRectangle({
        x: 0,
        y: PAGE_HEIGHT - 40,
        width: PAGE_WIDTH,
        height: 40,
        color: colors.primary,
      });

      // Header text
      page.drawText("Vehicle Inspection Report", {
        x: MARGIN,
        y: PAGE_HEIGHT - 27,
        size: typography.header.size,
        font: typography.header.font,
        color: colors.white,
      });

      // Section title with consistent positioning
      if (title) {
        page.drawText(title, {
          x: MARGIN,
          y: PAGE_HEIGHT - 65,
          size: typography.heading2.size,
          font: typography.heading2.font,
          color: colors.primary,
        });
      }

      return { page, yPosition: PAGE_HEIGHT - (title ? 85 : 60) };
    };

    // TEXT WRAPPING FUNCTION
    const wrapText = (text: string, maxWidth: number, fontSize: number, font: any) => {
      if (!text) return [];
      const words = text.split(/\s+/);
      const lines = [];
      let currentLine = "";

      for (const word of words) {
        const testLine = currentLine + (currentLine ? " " : "") + word;
        const textWidth = font.widthOfTextAtSize(testLine, fontSize);

        if (textWidth <= maxWidth) {
          currentLine = testLine;
        } else {
          if (currentLine) {
            lines.push(currentLine);
            currentLine = word;
          } else {
            lines.push(word);
          }
        }
      }

      if (currentLine) lines.push(currentLine);
      return lines;
    };

    // RENDER WRAPPED TEXT FUNCTION
    const renderWrappedText = (
      page: any,
      text: string,
      x: number,
      y: number,
      maxWidth: number,
      fontSize: number,
      font: any,
      color = colors.text,
      lineSpacing = spacing.xs,
    ) => {
      const lines = wrapText(text, maxWidth, fontSize, font);
      let currentY = y;

      lines.forEach((line) => {
        page.drawText(line, {
          x,
          y: currentY,
          size: fontSize,
          font,
          color,
        });
        currentY -= fontSize + lineSpacing;
      });

      return currentY - spacing.xs;
    };

    // PAGE 1: COVER PAGE
    let { page, yPosition } = addPageWithHeader("");

    // Report title
    page.drawText("VEHICLE INSPECTION REPORT", {
      x: MARGIN,
      y: yPosition - spacing.sm,
      size: typography.title.size,
      font: typography.title.font,
      color: colors.primary,
    });

    yPosition -= spacing.section;
    page.drawText(`Report Date: ${reportDate}`, {
      x: MARGIN,
      y: yPosition,
      size: typography.heading3.size,
      font: typography.heading3.font,
      color: colors.textSecondary,
    });

    yPosition -= spacing.lg;
    page.drawText(`Inspection ID: ${reportData.inspection_id}`, {
      x: MARGIN,
      y: yPosition,
      size: typography.body.size,
      font: typography.body.font,
      color: colors.textLight,
    });

    // VEHICLE INFORMATION
    yPosition -= spacing.section;

    const vehicleTitle = `${summary.vehicle?.Year || "N/A"} ${summary.vehicle?.Make || "N/A"} ${summary.vehicle?.Model || "N/A"}`;
    page.drawText(vehicleTitle, {
      x: MARGIN,
      y: yPosition,
      size: typography.heading1.size,
      font: typography.heading1.font,
      color: colors.text,
    });

    yPosition -= spacing.section;

    // Vehicle information table
    const leftColumnData = [
      { label: "VIN", value: summary.vehicle?.VIN || inspection?.vin || "N/A" },
      { label: "Make", value: summary.vehicle?.Make || "N/A" },
      { label: "Year", value: summary.vehicle?.Year || "N/A" },
      { label: "Model", value: summary.vehicle?.Model || "N/A" },
      { label: "Engine", value: summary.vehicle?.Engine || "N/A" },
      { label: "Mileage", value: summary.vehicle?.Mileage || inspection?.mileage || "N/A" },
    ];

    const tableStartY = yPosition;
    const rowHeight = 25;

    for (let i = 0; i < leftColumnData.length; i++) {
      const currentRowY = tableStartY - i * rowHeight;
      const isEvenRow = i % 2 === 0;

      if (isEvenRow) {
        page.drawRectangle({
          x: MARGIN,
          y: currentRowY - rowHeight + spacing.xs,
          width: CONTENT_WIDTH,
          height: rowHeight,
          color: colors.backgroundLight,
        });
      }

      page.drawText(leftColumnData[i].label, {
        x: MARGIN + spacing.sm,
        y: currentRowY - spacing.md,
        size: typography.label.size,
        font: typography.label.font,
        color: colors.textSecondary,
      });

      page.drawText(String(leftColumnData[i].value || "N/A"), {
        x: MARGIN + 80,
        y: currentRowY - spacing.md,
        size: typography.value.size,
        font: typography.value.font,
        color: colors.text,
      });
    }

    // Table border
    page.drawRectangle({
      x: MARGIN,
      y: tableStartY - leftColumnData.length * rowHeight + spacing.xs,
      width: CONTENT_WIDTH,
      height: leftColumnData.length * rowHeight,
      borderColor: colors.border,
      borderWidth: 1,
    });

    yPosition = tableStartY - leftColumnData.length * rowHeight - spacing.sm;

    // OVERALL CONDITION SECTION
    yPosition -= spacing.xxl;
    page.drawText("OVERALL CONDITION", {
      x: MARGIN,
      y: yPosition,
      size: typography.heading2.size,
      font: typography.heading2.font,
      color: colors.primary,
    });

    yPosition -= spacing.xl;
    const score = summary.overallConditionScore || 0;
    const scoreBarWidth = 200;
    const scoreBarHeight = 8;

    // Background bar
    page.drawRectangle({
      x: MARGIN + spacing.sm,
      y: yPosition,
      width: scoreBarWidth,
      height: scoreBarHeight,
      color: colors.backgroundGray,
    });

    // Score bar
    const percentage = score / 10;
    let scoreColor = colors.danger;
    if (percentage >= 0.8) scoreColor = colors.success;
    else if (percentage >= 0.6) scoreColor = colors.warning;
    else if (percentage >= 0.4) scoreColor = rgb(1, 0.5, 0);

    page.drawRectangle({
      x: MARGIN + spacing.sm,
      y: yPosition,
      width: scoreBarWidth * percentage,
      height: scoreBarHeight,
      color: scoreColor,
    });

    // Score text
    page.drawText(`${score}/10`, {
      x: MARGIN + spacing.sm + scoreBarWidth + spacing.sm,
      y: yPosition - 2,
      size: typography.body.size,
      font: typography.body.font,
      color: colors.text,
    });

    yPosition -= spacing.xxl;
    const conditionGrade = score >= 8 ? "Excellent" : score >= 6 ? "Good" : score >= 4 ? "Fair" : "Poor";

    page.drawText(`Condition Grade: ${conditionGrade}`, {
      x: MARGIN + spacing.sm,
      y: yPosition,
      size: typography.heading3.size,
      font: typography.heading3.font,
      color: score >= 6 ? colors.success : colors.danger,
    });

    // EXPERT SUMMARY
    if (summary.overallComments) {
      yPosition -= spacing.xxl;
      page.drawText("EXPERT SUMMARY", {
        x: MARGIN,
        y: yPosition,
        size: typography.heading3.size,
        font: typography.heading3.font,
        color: colors.primary,
      });

      yPosition -= spacing.lg;
      yPosition = renderWrappedText(
        page,
        summary.overallComments,
        MARGIN + spacing.sm,
        yPosition,
        CONTENT_WIDTH - spacing.lg,
        typography.body.size,
        typography.body.font,
      );
    }

    // Add more pages for detailed sections
    const sections = [
      { name: "exterior", title: "EXTERIOR" },
      { name: "interior", title: "INTERIOR" },
      { name: "engine", title: "ENGINE & MECHANICAL" },
      { name: "paint", title: "PAINT" },
    ];

    sections.forEach((section) => {
      const sectionData = summary[section.name];
      if (sectionData) {
        const { page: sectionPage, yPosition: sectionY } = addPageWithHeader(section.title);
        
        let currentY = sectionY;
        
        // Section score
        sectionPage.drawText("Condition:", {
          x: MARGIN + spacing.sm,
          y: currentY - spacing.lg,
          size: typography.body.size,
          font: typography.body.font,
        });

        currentY -= spacing.section;
        
        // Score bar for section
        const sectionScore = sectionData.score || 0;
        sectionPage.drawRectangle({
          x: MARGIN + spacing.sm,
          y: currentY,
          width: scoreBarWidth,
          height: scoreBarHeight,
          color: colors.backgroundGray,
        });

        const sectionPercentage = sectionScore / 10;
        let sectionScoreColor = colors.danger;
        if (sectionPercentage >= 0.8) sectionScoreColor = colors.success;
        else if (sectionPercentage >= 0.6) sectionScoreColor = colors.warning;

        sectionPage.drawRectangle({
          x: MARGIN + spacing.sm,
          y: currentY,
          width: scoreBarWidth * sectionPercentage,
          height: scoreBarHeight,
          color: sectionScoreColor,
        });

        sectionPage.drawText(`${sectionScore}/10`, {
          x: MARGIN + spacing.sm + scoreBarWidth + spacing.sm,
          y: currentY - 2,
          size: typography.body.size,
          font: typography.body.font,
          color: colors.text,
        });

        currentY -= spacing.lg;

        // Problems
        if (sectionData.problems && sectionData.problems.length > 0) {
          sectionPage.drawText("Issues Detected:", {
            x: MARGIN + spacing.sm,
            y: currentY,
            size: typography.body.size,
            font: typography.body.font,
            color: colors.danger,
          });
          currentY -= spacing.md;

          sectionData.problems.forEach((problem: string) => {
            currentY = renderWrappedText(
              sectionPage,
              `• ${problem}`,
              MARGIN + spacing.lg,
              currentY,
              CONTENT_WIDTH - spacing.xxl,
              typography.bodySmall.size,
              typography.bodySmall.font,
              colors.danger,
            );
            currentY -= spacing.xs;
          });
        } else {
          sectionPage.drawText("No issues detected", {
            x: MARGIN + spacing.sm,
            y: currentY,
            size: typography.body.size,
            font: typography.body.font,
            color: colors.success,
          });
          currentY -= spacing.md;
        }

        // Repair cost
        if (sectionData.estimatedRepairCost && sectionData.estimatedRepairCost > 0) {
          currentY -= spacing.md;
          sectionPage.drawText(`Estimated Repair Cost: $${sectionData.estimatedRepairCost}`, {
            x: MARGIN + spacing.sm,
            y: currentY,
            size: typography.body.size,
            font: typography.body.font,
            color: colors.primary,
          });
        }
      }
    });

    // FOOTER FOR ALL PAGES
    const pages = pdfDoc.getPages();
    pages.forEach((currentPage, index) => {
      currentPage.drawRectangle({
        x: MARGIN,
        y: 40,
        width: CONTENT_WIDTH,
        height: 1,
        color: colors.borderLight,
      });

      currentPage.drawText(`Page ${index + 1} of ${pages.length}`, {
        x: PAGE_WIDTH - MARGIN - 50,
        y: 25,
        size: typography.footer.size,
        font: typography.footer.font,
        color: colors.textLight,
      });

      currentPage.drawText("Generated by FixMate Vehicle Inspection System", {
        x: MARGIN,
        y: 25,
        size: typography.footer.size,
        font: typography.footer.font,
        color: colors.textLight,
      });
    });

    // Generate PDF bytes
    const pdfBytes = await pdfDoc.save();
    return pdfBytes;

  } catch (error) {
    console.error("Error generating PDF:", error);
    throw error;
  }
}

// Function to send email notification with PDF attachment
async function sendReportEmail(email: string, inspectionId: string, reportId: string, vehicleInfo: any, summary: string, pdfBytes?: Uint8Array) {
  try {
    const reportUrl = `${APP_BASE_URL}/report/${inspectionId}`;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    
    if (!resendApiKey) {
      console.error("RESEND_API_KEY is not set");
      return { success: false, error: "RESEND_API_KEY is not set" };
    }

    // Prepare email payload
    const emailPayload: any = {
      from: 'Vehicle Inspection <mark@verta-sense.com>',
      to: email,
      subject: `Your Vehicle Inspection Report is Ready`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f8f9fa; padding: 20px; text-align: center; border-bottom: 3px solid #4CAF50;">
          <h1 style="color: #333; margin: 0;">Your Vehicle Inspection Report</h1>
        </div>
        
        <div style="padding: 20px; background-color: white;">
          <p>Hello,</p>
          
          <p>Your vehicle inspection report for <strong>${vehicleInfo.vin}</strong> is now ready to view.</p>
          
          <div style="background-color: #f5f5f5; border-left: 4px solid #4CAF50; padding: 15px; margin: 20px 0;">
            <p style="margin: 0; font-style: italic;">"${summary}"</p>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${reportUrl}" style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">View Full Report</a>
          </div>
          
          <p>This report includes:</p>
          <ul>
            <li>Detailed analysis of your vehicle's condition</li>
            <li>Identified issues and their severity</li>
            <li>Fair market value assessment</li>
            <li>Recommendations for next steps</li>
          </ul>
          
          <p>${pdfBytes ? 'A detailed PDF report is attached to this email for your records.' : 'Your report will be available for 30 days.'} If you have any questions, please reply to this email.</p>
          
          <p>Thank you for using our service!</p>
        </div>
        
        <div style="padding: 20px; text-align: center; font-size: 12px; color: #666; background-color: #f8f9fa;">
          <p>© 2025 Vehicle Inspection Service. All rights reserved.</p>
          <p>This email was sent to you because you requested a vehicle inspection report.</p>
        </div>
      </div>
      `
    };

    // Add PDF attachment if provided
    if (pdfBytes) {
      // Convert Uint8Array to base64 string
      const base64String = btoa(String.fromCharCode(...pdfBytes));
      
      emailPayload.attachments = [
        {
          filename: `Vehicle_Inspection_Report_${vehicleInfo.vin}_${new Date().toISOString().split('T')[0]}.pdf`,
          content: base64String,
          type: 'application/pdf',
          disposition: 'attachment'
        }
      ];
    }
    
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(emailPayload)
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: "Unknown error" }));
      console.error("Error sending email:", errorData);
      return { success: false, error: errorData };
    }
    
    const data = await response.json();
    console.log("Email sent successfully:", data);
    return { success: true, data };
    
  } catch (error) {
    console.error("Unexpected error sending email:", error);
    return { success: false, error };
  }
}

// Add this function before the main serve function
async function calculateTotalCostsFromJobs(inspectionId: string) {
  const { data: jobs } = await supabase
    .from("processing_jobs")
    .select("cost, total_tokens, web_search_count, web_search_results")
    .eq("inspection_id", inspectionId)
    .eq("status", "completed");

  if (!jobs || jobs.length === 0) {
    return {
      totalCost: 0,
      totalTokens: 0,
      totalWebSearchCount: 0,
      allWebSearchResults: []
    };
  }

  const totalCost = jobs.reduce((sum, job) => sum + (job.cost || 0), 0);
  const totalTokens = jobs.reduce((sum, job) => sum + (job.total_tokens || 0), 0);
  const totalWebSearchCount = jobs.reduce((sum, job) => sum + (job.web_search_count || 0), 0);
  const allWebSearchResults = jobs.flatMap(job => job.web_search_results || []);

  return {
    totalCost,
    totalTokens,
    totalWebSearchCount,
    allWebSearchResults
  };
}


// Main serve function
serve(async (req) => {
  try {
    console.log("Generate-final-report function called");
    
    const payload = await req.json();
    const inspectionId = payload.inspection_id;
    
    console.log(`Generating final report for inspection ${inspectionId}`);
    
    // Update inspection status to finalizing
    await supabase
      .from("inspections")
      .update({ status: "finalizing" })
      .eq("id", inspectionId);
    
    // Get the final chunk result (last completed chunk analysis)
    const { data: finalChunkJob, error: finalChunkError } = await supabase
      .from("processing_jobs")
      .select("chunk_result, sequence_order")
      .eq("inspection_id", inspectionId)
      .eq("job_type", "chunk_analysis")
      .eq("status", "completed")
      .order("sequence_order", { ascending: false })
      .limit(1)
      .single();
    
    if (finalChunkError || !finalChunkJob || !finalChunkJob.chunk_result) {
      console.error("Error fetching final chunk result:", finalChunkError);
      await supabase.from("inspections").update({ status: "failed" }).eq("id", inspectionId);
      return new Response(JSON.stringify({ error: "No final chunk result found" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // Get the base analysis from the final chunk
    let parsedAnalysis = finalChunkJob.chunk_result;
    
    // Get all completed jobs for this inspection in sequence order
    const { data: allJobs } = await supabase
      .from("processing_jobs")
      .select("job_type, chunk_result, sequence_order")
      .eq("inspection_id", inspectionId)
      .eq("status", "completed")
      .order("sequence_order", { ascending: true });
    
    // Merge results from each agent
    if (allJobs) {
      for (const job of allJobs) {
        if (job.job_type === "ownership_cost_forecast" && job.chunk_result?.ownershipCostForecast) {
          parsedAnalysis.ownershipCostForecast = job.chunk_result.ownershipCostForecast;
        } else if (job.job_type === "fair_market_value" && job.chunk_result) {
          if (job.chunk_result.finalFairValueUSD) {
            parsedAnalysis.finalFairValueUSD = job.chunk_result.finalFairValueUSD;
          }
          if (job.chunk_result.priceAdjustment) {
            parsedAnalysis.priceAdjustment = job.chunk_result.priceAdjustment;
          }
        } else if (job.job_type === "expert_advice" && job.chunk_result?.advice) {
          parsedAnalysis.advice = job.chunk_result.advice;
        }
      }
    }
    
    // Get inspection details
    const { data: inspection, error: inspectionError } = await supabase
      .from("inspections")
      .select("id, vin, email")
      .eq("id", inspectionId)
      .single();
    
    if (inspectionError) {
      console.error("Error fetching inspection:", inspectionError);
      await supabase.from("inspections").update({ status: "failed" }).eq("id", inspectionId);
      return new Response(JSON.stringify({ error: "Failed to fetch inspection details" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // Calculate total costs from all jobs
    const costData = await calculateTotalCostsFromJobs(inspectionId);
    
    // Get chunk count for reporting
    const { data: allChunks } = await supabase
      .from("processing_jobs")
      .select("id")
      .eq("inspection_id", inspectionId)
      .eq("job_type", "chunk_analysis")
      .eq("status", "completed");
    
    // Extract overall summary from the final analysis
    const overallSummary = `Overall condition score: ${parsedAnalysis.overallConditionScore}/10. ${parsedAnalysis.overallComments || ""}`;
    
    // Create or update the report with the analysis results
    let reportId;
    const { data: existingReport, error: reportCheckError } = await supabase
      .from("reports")
      .select("id")
      .eq("inspection_id", inspectionId)
      .maybeSingle();

    
    if (existingReport) {
      reportId = existingReport.id;
      await supabase
        .from("reports")
        .update({
          summary_json: parsedAnalysis,
          summary: overallSummary,
          cost: costData.totalCost,
          total_tokens: costData.totalTokens,
          web_search_count: costData.totalWebSearchCount,
          web_search_results: costData.allWebSearchResults,
          ai_model: "gpt-4.1",
          updated_at: new Date().toISOString()
        })
        .eq("id", reportId);
    } else {
      const { data: newReport } = await supabase
        .from("reports")
        .insert({
          inspection_id: inspectionId,
          summary_json: parsedAnalysis,
          summary: overallSummary,
          cost: costData.totalCost,
          total_tokens: costData.totalTokens,
          ai_model: "gpt-4.1",
          web_search_count: costData.totalWebSearchCount,
          web_search_results: costData.allWebSearchResults
        })
        .select("id")
        .single();
      reportId = newReport?.id;
    }
    
    // Fetch photos and title images for PDF generation
    const { data: photos } = await supabase
      .from("photos")
      .select("category, path")
      .eq("inspection_id", inspectionId);

    const { data: titleImages } = await supabase
      .from("title_images")
      .select("*")
      .eq("inspection_id", inspectionId);

    // Generate PDF report
    console.log("Generating PDF report...");
    let pdfBytes: Uint8Array | undefined;
    try {
      // Create report data object for PDF generation
      const reportDataForPDF = {
        summary_json: parsedAnalysis,
        inspection_id: inspectionId,
        created_at: new Date().toISOString()
      };

      pdfBytes = await generatePDFReport(
        inspectionId,
        reportDataForPDF,
        inspection,
        photos || [],
        titleImages || []
      );
      console.log("PDF generated successfully, size:", pdfBytes.length, "bytes");
    } catch (pdfError) {
      console.error("Error generating PDF:", pdfError);
      // Continue without PDF if generation fails
      pdfBytes = undefined;
    }

    // Send email notification with PDF attachment
    const vehicleInfo = {
      vin: inspection.vin
    };
    
    const emailResult = await sendReportEmail(inspection.email, inspectionId, reportId, vehicleInfo, overallSummary, pdfBytes);
    
    // Update inspection status to 'done' and mark email as sent
    await supabase
      .from("inspections")
      .update({ 
        status: "done",
        email_sent: emailResult.success 
      })
      .eq("id", inspectionId);
    
    console.log(`Successfully generated final report for inspection ${inspectionId}`);
    
    return new Response(JSON.stringify({
      success: true,
      message: "Final report generated successfully",
      inspectionId,
      reportId,
      totalChunks: allChunks?.length || 0,
      overallScore: parsedAnalysis.overallConditionScore
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
    
  } catch (error) {
    console.error("Unexpected error in generate-final-report:", error);
    return new Response(JSON.stringify({
      error: "Internal server error",
      message: error.message
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});
