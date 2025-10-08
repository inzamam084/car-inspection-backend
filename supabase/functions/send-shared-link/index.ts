import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { create } from "https://deno.land/x/djwt@v2.8/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// --- Types ---

interface CreateSharedLinkRequest {
  recipientEmail?: string;
  recipientPhone?: string;
  maxUses: number;
  expiresInDays?: number; // Optional, defaults to 7 days
  inspectionIds?: string[]; // Optional - link to specific inspections
}

interface CreateSharedLinkResponse {
  success: boolean;
  shareUrl?: string;
  token?: string;
  sharedLinkId?: string;
  emailSent?: boolean;
  smsSent?: boolean;
  emailError?: string;
  smsError?: string;
  error?: string;
}

// --- Token Generation using djwt ---

async function generateSecureToken(
  userId: string,
  expiresAt: Date
): Promise<string> {
  try {
    // Get or generate a secret key for JWT signing
    const jwtSecret =
      Deno.env.get("JWT_SECRET") || "your-secret-key-change-this";

    // Convert secret to CryptoKey for signing
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(jwtSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );

    // Create JWT payload
    const payload = {
      sub: userId,
      type: "shared_link",
      exp: Math.floor(expiresAt.getTime() / 1000), // JWT exp is in seconds
      iat: Math.floor(Date.now() / 1000),
      jti: crypto.randomUUID(), // Unique token identifier
    };

    // Create and sign the JWT
    const jwt = await create({ alg: "HS256", typ: "JWT" }, payload, key);

    return jwt;
  } catch (error) {
    console.error("Error generating JWT token:", error);
    // Fallback to crypto random if JWT generation fails
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    // Convert to base64 using btoa
    const base64 = btoa(String.fromCharCode(...randomBytes));
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }
}

// --- Email Service (SMTP2GO) ---

async function sendEmail(
  recipientEmail: string,
  shareUrl: string,
  expiresAt: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const smtp2goApiKey = Deno.env.get("SMTP2GO_API_KEY");
    const fromEmail = '"FixPilot" <noreply@fixpilot.co>';

    if (!smtp2goApiKey) {
      console.error("SMTP2GO_API_KEY is not set in environment");
      return { success: false, error: "Email service not configured" };
    }

    const expirationDate = new Date(expiresAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const emailPayload = {
      api_key: smtp2goApiKey,
      to: [recipientEmail],
      sender: fromEmail,
      subject: "Vehicle Inspection Upload Link - FixPilot",
      html_body: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #0F9488; margin: 0;">FixPilot</h1>
          </div>
          
          <h2 style="color: #333; margin-bottom: 20px;">Vehicle Inspection Upload Link</h2>
          
          <p style="color: #555; line-height: 1.6;">
            You've been invited to upload vehicle inspection files using FixPilot.
          </p>
          
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <p style="margin: 0; color: #666;">
              <strong>Expiration Date:</strong> ${expirationDate}
            </p>
          </div>

          <div style="margin: 40px 0; text-align: center;">
            <a href="${shareUrl}" 
               style="background-color: #0F9488; 
                      color: white; 
                      padding: 14px 32px; 
                      text-decoration: none; 
                      border-radius: 6px; 
                      display: inline-block;
                      font-weight: 600;">
              Start Inspection
            </a>
          </div>

          <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e0e0e0;">
            <p style="color: #666; font-size: 14px; margin: 5px 0;">
              <strong>FixPilot Team</strong>
            </p>
            <p style="color: #999; font-size: 12px; margin: 5px 0;">
              This link will expire on ${expirationDate}. If you have any questions, please contact support.
            </p>
          </div>
        </div>
      `,
    };

    console.log("Sending email to:", recipientEmail);

    const response = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Smtp2go-Api-Key": smtp2goApiKey,
      },
      body: JSON.stringify(emailPayload),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error("SMTP2GO API error:", errorData);
      return {
        success: false,
        error: `SMTP2GO API error: ${response.status}`,
      };
    }

    const result = await response.json();

    if (result.data && result.data.succeeded > 0) {
      console.log("Email sent successfully to:", recipientEmail);
      return { success: true };
    } else {
      const errorMsg = result.data?.error || "Unknown SMTP2GO error";
      console.error("SMTP2GO error:", errorMsg);
      return { success: false, error: errorMsg };
    }
  } catch (error) {
    console.error("Error sending email:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// --- SMS Service (Twilio with proper encoding) ---

async function sendSMS(
  recipientPhone: string,
  shareUrl: string,
  expiresAt: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const twilioAccountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const twilioAuthToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const twilioPhoneNumber = Deno.env.get("TWILIO_PHONE_NUMBER");

    if (!twilioAccountSid || !twilioAuthToken || !twilioPhoneNumber) {
      console.error("Twilio credentials not set in environment");
      return { success: false, error: "SMS service not configured" };
    }

    // Format expiration date
    const expirationDate = new Date(expiresAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

    // Construct SMS message
    const message = `FixPilot: You've been invited to upload vehicle inspection files.\n\nAccess your upload portal here: ${shareUrl}\n\nThis link will expire on ${expirationDate}.`;

    console.log("Sending SMS to:", recipientPhone);

    // Twilio API endpoint
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`;

    // Create Basic Auth header using btoa (built-in base64 encoding)
    const credentials = `${twilioAccountSid}:${twilioAuthToken}`;
    const encodedCredentials = btoa(credentials);

    // Prepare form data
    const formData = new URLSearchParams();
    formData.append("To", recipientPhone);
    formData.append("From", twilioPhoneNumber);
    formData.append("Body", message);

    const response = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${encodedCredentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error("Twilio API error:", errorData);
      return {
        success: false,
        error: `Twilio API error: ${response.status}`,
      };
    }

    const result = await response.json();

    if (result.sid) {
      console.log("SMS sent successfully. SID:", result.sid);
      return { success: true };
    } else {
      console.error("Twilio error:", result);
      return {
        success: false,
        error: result.message || "Unknown Twilio error",
      };
    }
  } catch (error) {
    console.error("Error sending SMS:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// --- Main Handler ---

serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Get authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({
          error: "No authorization header",
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Create Supabase clients
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    // Client for authentication (with anon key)
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey);

    // Client for database operations (with service role key)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Get the user from the JWT token
    const {
      data: { user },
      error: userError,
    } = await supabaseAuth.auth.getUser(authHeader.replace("Bearer ", ""));

    if (userError || !user) {
      return new Response(
        JSON.stringify({
          error: "Invalid user token",
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("Authenticated user:", user.id);

    // Parse request body
    const body: CreateSharedLinkRequest = await req.json();
    const {
      recipientEmail,
      recipientPhone,
      maxUses,
      expiresInDays = 7,
      inspectionIds,
    } = body;

    // Validate required fields
    if (!maxUses || maxUses < 1) {
      return new Response(
        JSON.stringify({
          error: "maxUses is required and must be greater than 0",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check if at least one notification method is provided
    if (!recipientEmail && !recipientPhone) {
      return new Response(
        JSON.stringify({
          error:
            "At least one notification method required: recipientEmail or recipientPhone",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("Creating shared link for user:", user.id);

    // Step 1: Calculate expiration date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    // Step 2: Generate secure JWT token using djwt
    const token = await generateSecureToken(user.id, expiresAt);
    console.log(
      "Generated JWT token (first 20 chars):",
      token.substring(0, 20) + "..."
    );

    // Step 3: Create shared link in database
    const { data: sharedLink, error: createError } = await supabaseAdmin
      .from("shared_links")
      .insert({
        token,
        created_by: user.id,
        recipient_email: recipientEmail || null,
        expires_at: expiresAt.toISOString(),
        max_uses: maxUses,
        current_uses: 0,
        status: "active",
        metadata: recipientPhone
          ? { recipient_phone: recipientPhone }
          : undefined,
      })
      .select("id")
      .single();

    if (createError || !sharedLink) {
      console.error("Error creating shared link:", createError);
      return new Response(
        JSON.stringify({
          error: "Failed to create shared link",
          details: createError?.message,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("Shared link created with ID:", sharedLink.id);

    // Step 4: Link to inspections if provided
    if (inspectionIds && inspectionIds.length > 0) {
      const inspectionLinks = inspectionIds.map((inspectionId) => ({
        shared_link_id: sharedLink.id,
        inspection_id: inspectionId,
      }));

      const { error: linkError } = await supabaseAdmin
        .from("shared_link_inspections")
        .insert(inspectionLinks);

      if (linkError) {
        console.error("Error linking inspections:", linkError);
        // Continue anyway - the shared link is created
      } else {
        console.log(
          `Linked ${inspectionIds.length} inspections to shared link`
        );
      }
    }

    // Step 5: Generate share URL
    const appBaseUrl = Deno.env.get("APP_BASE_URL") || "https://fixpilot.ai";
    const shareUrl = `${appBaseUrl}/start?token=${token}`;

    console.log("Share URL generated");

    // Step 6: Send notifications
    const result: CreateSharedLinkResponse = {
      success: true,
      shareUrl,
      token,
      sharedLinkId: sharedLink.id,
      emailSent: false,
      smsSent: false,
    };

    // Send email if recipient email is provided
    if (recipientEmail) {
      console.log("Processing email notification for:", recipientEmail);
      const emailResult = await sendEmail(
        recipientEmail,
        shareUrl,
        expiresAt.toISOString()
      );

      if (emailResult.success) {
        result.emailSent = true;
        console.log("Email sent successfully");
      } else {
        result.emailError = emailResult.error;
        console.warn("Email sending failed:", emailResult.error);
      }
    }

    // Send SMS if recipient phone is provided
    if (recipientPhone) {
      console.log("Processing SMS notification for:", recipientPhone);
      const smsResult = await sendSMS(
        recipientPhone,
        shareUrl,
        expiresAt.toISOString()
      );

      if (smsResult.success) {
        result.smsSent = true;
        console.log("SMS sent successfully");
      } else {
        result.smsError = smsResult.error;
        console.warn("SMS sending failed:", smsResult.error);
      }
    }

    // Step 7: Log summary and return response
    console.log("Shared link creation summary:", {
      sharedLinkId: sharedLink.id,
      tokenPreview: token.substring(0, 20) + "...",
      emailRequested: !!recipientEmail,
      emailSent: result.emailSent,
      smsRequested: !!recipientPhone,
      smsSent: result.smsSent,
    });

    // Determine response status based on notification results
    const requestedEmail = !!recipientEmail;
    const requestedSMS = !!recipientPhone;
    const notificationCount = [requestedEmail, requestedSMS].filter(
      Boolean
    ).length;
    const successCount = [result.emailSent, result.smsSent].filter(
      Boolean
    ).length;

    if (successCount === notificationCount) {
      // All requested notifications sent successfully
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else if (successCount > 0) {
      // Some notifications sent successfully
      return new Response(JSON.stringify(result), {
        status: 207, // Multi-Status
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else {
      // All notifications failed, but link was created
      return new Response(JSON.stringify(result), {
        status: 207, // Multi-Status (link created but notifications failed)
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (error) {
    console.error("Error in create-shared-link function:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
