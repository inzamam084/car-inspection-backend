import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface EmailVerifiedPayload {
  type: "INSERT" | "UPDATE";
  table: string;
  schema: string;
  record: {
    id: string;
    email: string;
    email_confirmed_at: string;
  };
  old_record: {
    id: string;
    email: string;
    email_confirmed_at: string | null;
  } | null;
}

interface WebhookPayload {
  event: "email_verified";
  user_id: string;
  email: string;
  verified_at: string;
}

serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Initialize Resend client
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY is not configured");
    }
    // We'll use SMTP2GO like the send-shared-link function for consistency
    const smtp2goApiKey = Deno.env.get("SMTP2GO_API_KEY");
    if (!smtp2goApiKey && !resendApiKey) {
      throw new Error(
        "Neither RESEND_API_KEY nor SMTP2GO_API_KEY is configured"
      );
    }

    // Parse the webhook payload
    const payload: WebhookPayload = await req.json();
    console.log("Webhook payload received:", payload);

    // Validate the event type
    if (payload.event !== "email_verified") {
      console.log("Event is not email_verified, skipping...");
      return new Response(
        JSON.stringify({ success: true, message: "Event ignored" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    // Extract user details
    const { user_id, email, verified_at } = payload;

    // Check if welcome email has already been sent
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("welcome_email_sent")
      .eq("id", user_id)
      .single();

    if (profileError) {
      console.error("Error fetching profile:", profileError);
      // Continue anyway - we'll try to send the email
    }

    if (profile?.welcome_email_sent) {
      console.log("Welcome email already sent to user:", email);
      return new Response(
        JSON.stringify({
          success: true,
          message: "Welcome email already sent",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    // Prepare the welcome email HTML content
    const emailHtml = `
Welcome to FixPilot!

Download the Chrome extension to run inspections on online auction listings:
https://chromewebstore.google.com/detail/fixpilot-ai-%E2%80%93-vehicle-rep/gnmbpkihdfolkcepmlbmfpcghgblboao

Download the iOS app for inspecting vehicles in person:
https://apps.apple.com/us/app/fixpilot/id6740345560

Happy inspecting!
The FixPilot Team
`;

    // Send the welcome email using SMTP2GO or Resend
    let emailResponse: any;

    if (smtp2goApiKey) {
      // Use SMTP2GO (consistent with send-shared-link)
      const emailPayload = {
        api_key: smtp2goApiKey,
        to: [email],
        sender: '"FixPilot" <noreply@fixpilot.co>',
        subject: "Welcome to FixPilot",
        html_body: emailHtml,
      };

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
        throw new Error(`SMTP2GO API error: ${response.status} - ${errorData}`);
      }

      emailResponse = await response.json();

      if (!emailResponse.data || emailResponse.data.succeeded === 0) {
        throw new Error(
          emailResponse.data?.error || "Failed to send email via SMTP2GO"
        );
      }

      emailResponse.id = emailResponse.request_id; // Normalize response
    } else if (resendApiKey) {
      // Fallback to Resend if configured
      const resendPayload = {
        from: "FixPilot <noreply@fixpilot.com>",
        to: email,
        subject: "Welcome to FixPilot",
        html: emailHtml,
      };

      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(resendPayload),
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Resend API error: ${response.status} - ${errorData}`);
      }

      emailResponse = await response.json();
    }

    console.log("Email sent successfully:", emailResponse);

    // Update the profile to mark welcome email as sent
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        welcome_email_sent: true,
        welcome_email_sent_at: new Date().toISOString(),
      })
      .eq("id", user_id);

    if (updateError) {
      console.error("Error updating profile:", updateError);
      // Don't fail the request if we can't update the profile
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Welcome email sent successfully",
        email_id: emailResponse.id,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error("Error in on-email-verified function:", error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Internal server error",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
