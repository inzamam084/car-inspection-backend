import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { supabase } from "./config.ts";
import {
  runAnalysisInBackground,
  runScrapeThenAnalysis,
} from "./run-inspection-processor.ts";
import { processExtensionData } from "./extension-processor.ts";
import type {
  WebhookPayload,
  ExtensionPayload,
  ExtensionVehicleData,
  ApiResponse,
  ErrorResponse,
  Inspection,
} from "./schemas.ts";

// Main serve function
serve(async (req): Promise<Response> => {
  try {
    console.log("Request received..");

    // Check if request has a body
    const contentLength = req.headers.get("content-length");
    const contentType = req.headers.get("content-type");

    console.log(
      `Content-Length: ${contentLength}, Content-Type: ${contentType}`
    );

    if (!contentLength || contentLength === "0") {
      console.error("Request body is empty");
      const errorResponse: ErrorResponse = {
        error: "Request body is required",
      };
      return new Response(JSON.stringify(errorResponse), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    // Parse the request payload with error handling
    let payload: WebhookPayload | ExtensionPayload;
    try {
      const requestText = await req.text();
      console.log("Raw request body:", requestText);

      if (!requestText.trim()) {
        throw new Error("Empty request body");
      }

      payload = JSON.parse(requestText);
    } catch (parseError) {
      console.error("JSON parsing error:", parseError);
      const errorResponse: ErrorResponse = {
        error: "Invalid JSON in request body",
      };
      return new Response(JSON.stringify(errorResponse), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    console.log("Received payload:", JSON.stringify(payload));

    // Check if this is extension data (has vehicleData) or webhook data (has inspection_id)
    if ("vehicleData" in payload) {
      // Handle extension data
      console.log("Processing extension vehicle data");
      const extensionPayload = payload as ExtensionPayload;

      const result = await processExtensionData(extensionPayload.vehicleData);

      if (result.success) {
        const response: ApiResponse = {
          success: true,
          message: "Extension data processed successfully",
          inspectionId: result.inspectionId!,
          status: "processing",
        };

        return new Response(JSON.stringify(response), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        });
      } else {
        const errorResponse: ErrorResponse = {
          error: result.error || "Failed to process extension data",
        };
        return new Response(JSON.stringify(errorResponse), {
          status: 500,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }
    } else if ("inspection_id" in payload) {
      // Handle webhook data (existing logic)
      const webhookPayload = payload as WebhookPayload;

      if (!webhookPayload.inspection_id) {
        console.error("Missing inspection_id in payload");
        const errorResponse: ErrorResponse = {
          error: "inspection_id is required in request payload",
        };
        return new Response(JSON.stringify(errorResponse), {
          status: 400,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }

      const inspectionId = webhookPayload.inspection_id;
      console.log(`Processing analysis for inspection ${inspectionId}`);

      // Basic validation - just check if inspection exists
      const { data: inspection, error: inspectionError } = await supabase
        .from("inspections")
        .select("id, vin, email, type, url")
        .eq("id", inspectionId)
        .single();

      if (inspectionError) {
        console.error("Error fetching inspection:", inspectionError);
        const errorResponse: ErrorResponse = {
          error: "Failed to fetch inspection details",
        };
        return new Response(JSON.stringify(errorResponse), {
          status: 500,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }

      // Decide which pipeline to invoke
      const backgroundTask =
        inspection.type === "url"
          ? () => runScrapeThenAnalysis(inspection as Inspection)
          : () => runAnalysisInBackground(inspection.id);

      // Kick off in background
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        EdgeRuntime.waitUntil(backgroundTask());
      } else {
        backgroundTask().catch((err) => console.error(err));
      }

      // Return immediate response
      const response: ApiResponse = {
        success: true,
        message: "Analysis started in background",
        inspectionId,
        status: "processing",
      };

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    } else if (
      "gallery_images" in payload &&
      "make" in payload &&
      "model" in payload &&
      "year" in payload
    ) {
      // Handle extension data (direct format - for backward compatibility)
      console.log("Processing extension vehicle data (direct format)");
      const vehicleData = payload as ExtensionVehicleData;

      const result = await processExtensionData(vehicleData);

      if (result.success) {
        const response: ApiResponse = {
          success: true,
          message: "Extension data processed successfully",
          inspectionId: result.inspectionId!,
          status: "processing",
        };

        return new Response(JSON.stringify(response), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        });
      } else {
        const errorResponse: ErrorResponse = {
          error: result.error || "Failed to process extension data",
        };
        return new Response(JSON.stringify(errorResponse), {
          status: 500,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }
    } else {
      // Invalid payload format
      const errorResponse: ErrorResponse = {
        error:
          "Invalid payload format. Expected either 'vehicleData', 'inspection_id', or direct vehicle data with required fields (gallery_images, make, model, year)",
      };
      return new Response(JSON.stringify(errorResponse), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }
  } catch (error) {
    console.error("Unexpected error:", error);
    const errorResponse: ErrorResponse = {
      error: "Internal server error",
    };
    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
});
