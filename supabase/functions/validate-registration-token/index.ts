import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  token: string;
  markAsUsed?: boolean;
}

interface TokenRecord {
  id: string;
  token: string;
  created_by: string;
  recipient_email: string;
  expires_at: string;
  status: string;
  metadata: Record<string, any> | null;
  used_at: string | null;
  created_at: string;
  updated_at: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Create Supabase client with service role for validation
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Parse request body
    const body: RequestBody = await req.json();
    const { token, markAsUsed = false } = body;

    // Validate input
    if (!token) {
      return new Response(
        JSON.stringify({
          success: false,
          valid: false,
          error: "Token is required",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Fetch token from database
    const { data: tokenData, error: fetchError } = await supabaseClient
      .from("registration_tokens")
      .select("*")
      .eq("token", token)
      .single();

    if (fetchError || !tokenData) {
      return new Response(
        JSON.stringify({
          success: true,
          valid: false,
          error: "Invalid token",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    const typedTokenData = tokenData as TokenRecord;

    // Check if token is expired
    const now = new Date();
    const expiresAt = new Date(typedTokenData.expires_at);
    const isExpired = now > expiresAt;

    // Check token status
    const validStatuses = ["active"];
    const isValidStatus = validStatuses.includes(typedTokenData.status);

    // Determine if token is valid
    const isValid = !isExpired && isValidStatus && !typedTokenData.used_at;

    // If requested and token is valid, mark as used
    if (markAsUsed && isValid) {
      const { error: updateError } = await supabaseClient
        .from("registration_tokens")
        .update({
          status: "used",
          used_at: new Date().toISOString(),
        })
        .eq("token", token);

      if (updateError) {
        console.error("Error marking token as used:", updateError);
        return new Response(
          JSON.stringify({
            success: false,
            valid: false,
            error: "Failed to mark token as used",
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 500,
          }
        );
      }
    }

    // Prepare validation response
    const response: any = {
      success: true,
      valid: isValid,
      data: isValid
        ? {
            recipient_email: typedTokenData.recipient_email,
            expires_at: typedTokenData.expires_at,
            metadata: typedTokenData.metadata,
          }
        : null,
    };

    // Add reason if invalid
    if (!isValid) {
      if (typedTokenData.used_at) {
        response.reason = "Token has already been used";
      } else if (isExpired) {
        response.reason = "Token has expired";
      } else if (!isValidStatus) {
        response.reason = `Token status is ${typedTokenData.status}`;
      }
    }

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error in validate-registration-token function:", error);
    return new Response(
      JSON.stringify({
        success: false,
        valid: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
