import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SharedLinkData {
  id: string;
  token: string;
  created_by: string;
  recipient_email?: string;
  expires_at: string;
  max_uses: number;
  current_uses: number;
  status: string;
  metadata?: any;
  first_accessed_at?: string;
  last_accessed_at?: string;
  completed_at?: string;
  revoked_at?: string;
  revoked_by?: string;
  revoke_reason?: string;
  created_at: string;
  updated_at: string;
  profiles?: {
    id: string;
    email: string;
    first_name?: string;
    last_name?: string;
  };
}

interface SharedLinkResponse {
  success: boolean;
  data?: SharedLinkData;
  error?: string;
  isExpired?: boolean;
  isMaxedOut?: boolean;
  isInactive?: boolean;
}

async function getSharedLinkByToken(token: string): Promise<SharedLinkResponse> {
  try {
    // Create Supabase admin client with service role key
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log("Fetching shared link for token:", token);

    // Fetch shared link data with profile information
    const { data: sharedLink, error } = await supabase
      .from("shared_links")
      .select(`
        *,
        profiles!shared_links_created_by_fkey (
          id,
          email,
          first_name,
          last_name
        )
      `)
      .eq("token", token)
      .single();

    if (error) {
      console.error("Error fetching shared link:", error);
      
      // If no data found
      if (error.code === "PGRST116") {
        return {
          success: false,
          error: "Shared link not found",
        };
      }
      
      return {
        success: false,
        error: "Failed to fetch shared link data",
      };
    }

    if (!sharedLink) {
      return {
        success: false,
        error: "Shared link not found",
      };
    }

    console.log("Fetched shared link:", sharedLink);

    // Validate the shared link
    const now = new Date();
    const expiresAt = new Date(sharedLink.expires_at);

    // Check if expired
    if (expiresAt < now) {
      return {
        success: false,
        data: sharedLink,
        error: "Shared link has expired",
        isExpired: true,
      };
    }

    // Check if max uses reached
    if (sharedLink.current_uses >= sharedLink.max_uses) {
      return {
        success: false,
        data: sharedLink,
        error: "Shared link has reached maximum uses",
        isMaxedOut: true,
      };
    }

    // Check if status is not active
    if (sharedLink.status !== "active") {
      return {
        success: false,
        data: sharedLink,
        error: `Shared link is ${sharedLink.status}`,
        isInactive: true,
      };
    }

    // Return the valid shared link data
    return {
      success: true,
      data: sharedLink,
    };
  } catch (error) {
    console.error("Error in getSharedLinkByToken:", error);
    return {
      success: false,
      error: error.message || "Internal server error",
    };
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Parse the request URL to get query parameters
    const url = new URL(req.url);
    const token = url.searchParams.get('token');

    if (!token) {
      return new Response(
        JSON.stringify({ 
          success: false,
          error: 'Token parameter is required' 
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        },
      );
    }

    // Get shared link data
    const result = await getSharedLinkByToken(token);

    // Determine HTTP status code based on result
    let statusCode = 200;
    if (!result.success) {
      if (result.error === 'Shared link not found') {
        statusCode = 404;
      } else if (result.isExpired || result.isMaxedOut || result.isInactive) {
        statusCode = 403;
      } else {
        statusCode = 500;
      }
    }

    return new Response(
      JSON.stringify(result),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: statusCode,
      },
    );
  } catch (error) {
    console.error('Error in get-shared-link function:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.message || 'Internal server error',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      },
    );
  }
})
