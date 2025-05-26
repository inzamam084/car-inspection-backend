import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { OpenAI } from "https://esm.sh/openai@4.87.3";
// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: Deno.env.get("OPENAI_API_KEY")
});
// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);
// Base URL for the application
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") || "https://ourfixmate.vercel.app/";
// Master Analysis Prompt
const PROMPT_MASTER = `SYSTEM
You are **AutoInsightGPT**, an ASE‑style certified vehicle‑inspection expert, classic‑car appraiser, body‑repair specialist, and data analyst in one.  
Your job is to give a buyer a crystal‑clear, data‑driven, no‑nonsense report.
INPUT YOU WILL RECEIVE
‣ A single JSON **DATA BLOCK** (in the same message) containing:
 {
   "vin":               string,        // 17‑char VIN
   "mileage":           number | null, // odo input if user typed it
   "zip":               string | null,
   "vinHistory":        string | null, // e.g. "1 accident in 2018; 3 owners"
   "marketPriceBands":  {              // optional guide values
       "concours": number,
       "excellent": number,
       "good": number,
       "fair": number
   }
 }
‣ Up to **7 images** attached in the same user message.  
 • Each image's \`image_url\` field carries an **alt** that begins with one of these labels  
   →  \`exterior\`, \`rust\`, \`interior\`, \`paint\`, \`dashboard\`, \`engine\`, \`undercarriage\`  
 • Example image wrapper (your callers supply it):  
   \`{ "type":"image_url", "image_url": { "url":"data:image/jpeg;base64,...", "detail":"auto", "alt":"exterior" } }\`
OUTPUT FORMAT (STRICT JSON — no extra keys, no comments)
{
 "vinSummary": {
   "decoded": "<50‑word decode of year/make/model/trim>",
   "historyFlag": "<risk|clean|mixed>",
   "historyNotes": "<30‑word bullet‑style summary>"
 },
 "imageFindings": {
   "exterior": {
     "problems": [ { "type":"dent|scratch|bondo|gap", "location":"text", "severity":0‑1, "repairCostUSD":integer } ],
     "score": 0‑10
   },
   "rust": {
     "spots": [ { "location":"text", "depth":"surface|penetrating", "severity":0‑1, "repairCostUSD":integer } ],
     "score": 0‑10
   },
   "interior": {
     "mods": [ "aftermarket head unit", "custom seats", ... ],
     "issues": [ "seat tear", "stain" ],
     "score": 0‑10
   },
   "paint": {
     "panelMismatch": true|false,
     "gapIssues": true|false,
     "notes": "text",
     "score": 0‑10
   },
   "dashboard": {
     "odometerOCR": number | null,
     "warningLights": [ "CEL", "ABS", ... ],
     "score": 0‑10
   },
   "engine": {
     "leaks": [ "oil", "coolant" ],
     "mods": [ "cold‑air intake" ],
     "score": 0‑10
   },
   "undercarriage": {
     "rustAreas": [ "frame rail", ... ],
     "leaks": [ "transmission", ... ],
     "damage": [ "scrape on cross‑member" ],
     "score": 0‑10
   }
 },
 "overallCondition": {
   "grade": "Excellent|Good|Fair|Poor",
   "numeric": 0‑100,
   "keyIssues": [ "rust on rocker", "dashboard CEL" ],
   "modImpact": "positive|neutral|negative"
 },
 "priceAdjustment": {
   "baselineBand": "concours|excellent|good|fair",
   "adjustmentUSD": integer,           // negative if value should drop
   "explanation": "≤40 words"
 },
 "finalFairValueUSD": integer,
 "advice": "≤60 words, plain‑English next steps"
}
RULES & LOGIC
1. **Work category‑by‑category** using the labeled images. Skip a category if its image is missing; still output the key with empty arrays and \`score:0\`.
2. **Scoring**  
  • 10 = immaculate; 0 = catastrophic.  
  • Use 5 = average older‑car wear.  
3. **Severity** is proportional to cost and visual impact (0=no issue, 1=severe).  
4. **RepairCostUSD** — rough US retail cost of fixing that item; use typical body‑shop or upholstery rates.  
5. **overallCondition.numeric** — average of category scores, weighted: exterior×1.5, rust×2, interior×1, paint×1, dashboard×1, engine×1.5, undercarriage×1.  
  Map: ≥85→Excellent, 70‑84→Good, 50‑69→Fair, else Poor.  
6. **Price logic**  
  • Start from \`marketPriceBands[baselineBand]\` where baselineBand = the grade from rule 5.  
  • Sum \`repairCostUSD\`. Subtract that plus an extra 10 % buffer as \`adjustmentUSD\`.  
  • Ensure \`finalFairValueUSD = baseline − adjustmentUSD\` (floor to nearest $50).  
  • If no \`marketPriceBands\` given, leave priceAdjustment values \`null\` and set finalFairValueUSD to null.  
7. If \`dashboard.warningLights\` contains "CEL" or any safety light, automatically deduct at least $500 in \`adjustmentUSD\`.  
8. **Never** reveal chain‑of‑thought. Output the JSON only.  
9. If image quality is too poor for any decision, note \`"notes": "image blurry"\` for that category and lower its score.  
10. Keep text concise; do not exceed specified word limits.`;
// Function to send email notification
async function sendReportEmail(email, inspectionId, reportId, vehicleInfo, summary) {
  try {
    const reportUrl = `${APP_BASE_URL}/report/${inspectionId}`;
    // Check if RESEND_API_KEY is available
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.error("RESEND_API_KEY is not set");
      return {
        success: false,
        error: "RESEND_API_KEY is not set"
      };
    }
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: 'Vehicle Inspection <mark@verta-sense.com>',
        to: email,
        subject: `Your Vehicle Inspection Report for ${vehicleInfo.year} ${vehicleInfo.make} ${vehicleInfo.model} is Ready`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #f8f9fa; padding: 20px; text-align: center; border-bottom: 3px solid #4CAF50;">
            <h1 style="color: #333; margin: 0;">Your Vehicle Inspection Report</h1>
          </div>
          
          <div style="padding: 20px; background-color: white;">
            <p>Hello,</p>
            
            <p>Your vehicle inspection report for your ${vehicleInfo.year} ${vehicleInfo.make} ${vehicleInfo.model} is now ready to view.</p>
            
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
            
            <p>Your report will be available for 30 days. If you have any questions, please reply to this email.</p>
            
            <p>Thank you for using our service!</p>
          </div>
          
          <div style="padding: 20px; text-align: center; font-size: 12px; color: #666; background-color: #f8f9fa;">
            <p>© 2025 Vehicle Inspection Service. All rights reserved.</p>
            <p>This email was sent to you because you requested a vehicle inspection report.</p>
          </div>
        </div>
        `
      })
    });
    // Process the response
    if (!response.ok) {
      const errorData = await response.json().catch(()=>({
          message: "Unknown error"
        }));
      console.error("Error sending email:", errorData);
      return {
        success: false,
        error: errorData
      };
    }
    const data = await response.json();
    console.log("Email sent successfully:", data);
    return {
      success: true,
      data
    };
  } catch (error) {
    console.error("Unexpected error sending email:", error);
    return {
      success: false,
      error
    };
  }
}
serve(async (req)=>{
  try {
    // Parse the webhook payload
    const payload = await req.json();
    console.log("Received webhook payload:", JSON.stringify(payload));
    const inspectionId = payload.inspection_id;
    console.log(`Processing analysis for inspection ${inspectionId}`);
    // 1. Fetch inspection details
    const { data: inspection, error: inspectionError } = await supabase.from("inspections").select("id, vin, email, mileage, zip").eq("id", inspectionId).single();
    if (inspectionError) {
      console.error("Error fetching inspection:", inspectionError);
      return new Response(JSON.stringify({
        error: "Failed to fetch inspection details"
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    // 2. Fetch all photos for this inspection
    const { data: photos, error: photosError } = await supabase.from("photos").select("id, category, path").eq("inspection_id", inspectionId);
    if (photosError) {
      console.error("Error fetching photos:", photosError);
      return new Response(JSON.stringify({
        error: "Failed to fetch photos"
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    if (!photos || photos.length === 0) {
      console.error("No photos found for inspection");
      return new Response(JSON.stringify({
        error: "No photos found for inspection"
      }), {
        status: 400,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    console.log(`Found ${photos.length} photos for analysis`);
    // 3. Create data block for the master prompt
    const dataBlock = {
      vin: inspection.vin,
      mileage: inspection?.mileage || null,
      zip: inspection?.zip || null,
      vinHistory: null,
      marketPriceBands: null // You may want to fetch this from a service
    };
    // 4. Prepare images for the master prompt
    const imageContents: any = [];
    // Add the data block as the first text element
    imageContents.push({
      type: "input_text",
      text: PROMPT_MASTER
    });
    imageContents.push({
      type: "input_text",
      text: `DATA_BLOCK: ${JSON.stringify(dataBlock)}`
    });
    // Add each image with the appropriate category label
    for (const photo of photos){
      // Map your existing categories to the required master prompt categories
      // You might need to adjust this mapping based on your actual category names
      const categoryMap = {
        "exterior": "exterior",
        "rust": "rust",
        "interior": "interior",
        "paint": "paint",
        "dashboard": "dashboard",
        "engine": "engine",
        "undercarriage": "undercarriage"
      };
      const masterCategory = categoryMap[photo.category] || photo.category;
      // Get the public URL for the image
      const imageUrl = photo.path;
      console.log("imageUrl: ", imageUrl);
      imageContents.push({
        type: "input_image",
        image_url: imageUrl
      });
    }
    console.log("Start inspection..");
    // 5. Call OpenAI with the Responses API (instead of Chat API)
    const response = await openai.responses.create({
      model: "gpt-4.1",
      input: [
        {
          role: "user",
          content: imageContents
        }
      ]
    });
    console.log("Generated response for inspection ID: ", inspectionId, " with response : ", response);
    let analysisResult;
    let parsedAnalysis;
    try {
      // First try to get the text from the response structure
      analysisResult = response.output_text || response.output && response.output[0] && response.output[0].content && response.output[0].content[0] && response.output[0].content[0].text || "{}";
      // Log the extracted text for debugging
      console.log("Extracted text for parsing:", analysisResult);
      // Parse the JSON string
      parsedAnalysis = JSON.parse(analysisResult);
    } catch (error) {
      console.error("Error parsing OpenAI response:", error);
      console.error("Response structure:", JSON.stringify(response, null, 2));
      parsedAnalysis = {
        error: "Failed to parse analysis result"
      };
    }
    // 6. Extract overall summary from the analysis
    const overallSummary = `${parsedAnalysis.overallCondition?.grade || "Unknown"} condition. ${parsedAnalysis.advice || ""}`;
    // 7. Create or update the report with the analysis results
    let reportId;
    // First check if a report already exists
    const { data: existingReport, error: reportCheckError } = await supabase.from("reports").select("id").eq("inspection_id", inspectionId).maybeSingle();
    if (reportCheckError) {
      console.error("Error checking for existing report:", reportCheckError);
      return new Response(JSON.stringify({
        error: "Failed to check for existing report"
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    if (existingReport) {
      // Update existing report
      reportId = existingReport.id;
      const { error: updateError } = await supabase.from("reports").update({
        summary_json: parsedAnalysis,
        summary: overallSummary,
        updated_at: new Date().toISOString()
      }).eq("id", reportId);
      if (updateError) {
        console.error("Error updating report:", updateError);
        return new Response(JSON.stringify({
          error: "Failed to update report with analysis"
        }), {
          status: 500,
          headers: {
            "Content-Type": "application/json"
          }
        });
      }
    } else {
      // Create new report
      const { data: newReport, error: createError } = await supabase.from("reports").insert({
        inspection_id: inspectionId,
        summary_json: parsedAnalysis,
        summary: overallSummary
      }).select("id").single();
      if (createError) {
        console.error("Error creating report:", createError);
        return new Response(JSON.stringify({
          error: "Failed to create report with analysis"
        }), {
          status: 500,
          headers: {
            "Content-Type": "application/json"
          }
        });
      }
      reportId = newReport.id;
    }
    // 8. Update inspection status to 'done'
    const { error: statusUpdateError } = await supabase.from("inspections").update({
      status: "done"
    }).eq("id", inspectionId);
    if (statusUpdateError) {
      console.error("Error updating inspection status:", statusUpdateError);
    // Continue anyway, as the report is already created/updated
    }
    // 9. Send email notification to the user
    const vehicleInfo = {
      year: inspection.year,
      make: inspection.make,
      model: inspection.model
    };
    const emailResult = await sendReportEmail(inspection.email, inspectionId, reportId, vehicleInfo, overallSummary);
    if (!emailResult.success) {
      console.error("Failed to send email notification:", emailResult.error);
    // Continue anyway, as the report is already created/updated
    }
    console.log(`Successfully processed inspection ${inspectionId}, report ${reportId}`);
    return new Response(JSON.stringify({
      success: true,
      reportId,
      inspectionId,
      emailSent: emailResult.success
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(JSON.stringify({
      error: "Internal server error"
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
});
