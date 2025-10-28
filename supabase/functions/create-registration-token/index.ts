import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  recipientEmail: string;
  expiresInDays?: number;
  metadata?: Record<string, any>;
}

interface TokenRecord {
  id: string;
  token: string;
  created_by: string;
  recipient_email: string;
  expires_at: string;
  status: string;
  metadata: Record<string, any> | null;
  created_at: string;
  updated_at: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      }
    );

    // Get authenticated user
    const {
      data: { user },
    } = await supabaseClient.auth.getUser();

    if (!user) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 401,
        }
      );
    }

    // Parse request body
    const body: RequestBody = await req.json();
    const { recipientEmail, expiresInDays = 7, metadata = {} } = body;

    // Validate input
    if (!recipientEmail) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Recipient email is required",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recipientEmail)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid email format",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Generate unique token
    const token = crypto.randomUUID();

    // Calculate expiry date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    // Insert token into database
    const { data: tokenData, error: tokenError } = await supabaseClient
      .from("registration_tokens")
      .insert({
        token,
        created_by: user.id,
        recipient_email: recipientEmail,
        expires_at: expiresAt.toISOString(),
        status: "active",
        metadata: {
          ...metadata,
          created_via: "edge_function",
        },
      })
      .select()
      .single();

    if (tokenError) {
      console.error("Error creating token:", tokenError);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Failed to create token",
          details: tokenError.message,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    const typedTokenData = tokenData as TokenRecord;

    // Send email with registration link using SMTP2GO
    let emailSent = false;
    let emailError: string | null = null;

    try {
      const registrationUrl = `${
        Deno.env.get("APP_BASE_URL") || "http://localhost:3000"
      }/register?token=${token}`;

      const smtp2goApiKey = Deno.env.get("SMTP2GO_API_KEY");
      const fromEmail = '"FixMate" <noreply@fixmate.com>';

      if (!smtp2goApiKey) {
        throw new Error("SMTP2GO configuration missing");
      }

      const emailPayload = {
        api_key: smtp2goApiKey,
        to: [recipientEmail],
        sender: fromEmail,
        subject: "Your FixMate Registration Invitation",
        html_body: `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h1>Welcome to FixMate!</h1>
              
              <p>Hello,</p>
              
              <p>You've been invited to join FixMate. Click the link below to create your account:</p>
              
              <p>
                <a href="${registrationUrl}" style="display: inline-block; background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">Create Your Account</a>
              </p>
              
              <p>Your registration link expires on: ${expiresAt.toLocaleDateString(
                "en-US",
                { year: "numeric", month: "long", day: "numeric" }
              )}</p>
              
              <p>If the button doesn't work, copy and paste this link into your browser:</p>
              <p style="word-break: break-all;">${registrationUrl}</p>
              
              <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
              
              <p style="font-size: 12px; color: #999;">If you didn't expect this invitation, you can safely ignore this email.</p>
            </body>
          </html>
        `,
      };

      console.log("Sending email to:", recipientEmail);

      const emailResponse = await fetch(
        "https://api.smtp2go.com/v3/email/send",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Smtp2go-Api-Key": smtp2goApiKey,
          },
          body: JSON.stringify(emailPayload),
        }
      );

      if (!emailResponse.ok) {
        const errorText = await emailResponse.text();
        emailError = `SMTP2GO error: ${errorText}`;
        console.error("SMTP2GO error:", errorText);
      } else {
        const result = await emailResponse.json();

        if (result.data && result.data.succeeded > 0) {
          emailSent = true;
          console.log("Email sent successfully to:", recipientEmail);
        } else {
          emailError = result.data?.error || "Unknown SMTP2GO error";
          console.error("SMTP2GO error:", emailError);
        }
      }
    } catch (error) {
      emailError = error instanceof Error ? error.message : "Unknown error";
      console.error("Error sending email:", error);
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          id: typedTokenData.id,
          token: typedTokenData.token,
          recipient_email: typedTokenData.recipient_email,
          expires_at: typedTokenData.expires_at,
          status: typedTokenData.status,
        },
        emailSent,
        emailError,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in create-registration-token function:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
