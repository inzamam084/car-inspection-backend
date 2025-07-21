import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Gemini API Configuration
const GEMINI_CONFIG = {
  apiKey: Deno.env.get("GEMINI_API_KEY") || "",
  baseUrl: "https://generativelanguage.googleapis.com",
  model: "gemini-2.5-pro",
  uploadUrl: "https://generativelanguage.googleapis.com/upload/v1beta/files",
};

// Declare EdgeRuntime for type safety
declare const EdgeRuntime: any;
// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Types for Gemini API
interface FileReference {
  uri: string;
  mimeType: string;
  category: string;
  originalPath: string;
  displayName: string;
}

interface ImageData {
  id: string;
  path: string;
  converted_path?: string;
  category: string;
  mimeType?: string;
}

// Upload single image to Gemini Files API
async function uploadImageToGeminiRest(
  imageUrl: string,
  category: string,
  imageId: string
): Promise<FileReference | null> {
  try {
    // Step 1: Fetch image from Supabase public URL
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch image: ${imageResponse.statusText}`);
    }

    const imageBlob = await imageResponse.blob();
    const imageBytes = await imageBlob.arrayBuffer();
    const mimeType = imageBlob.type || "image/jpeg";
    const displayName = `${category}_${imageId}_${Date.now()}`;

    // Step 2: Initial resumable upload request
    const initResponse = await fetch(GEMINI_CONFIG.uploadUrl, {
      method: "POST",
      headers: {
        "X-Goog-Api-Key": GEMINI_CONFIG.apiKey,
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": imageBytes.byteLength.toString(),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        file: {
          display_name: displayName,
        },
      }),
    });

    if (!initResponse.ok) {
      throw new Error(`Upload init failed: ${initResponse.statusText}`);
    }

    // Step 3: Get upload URL from response headers
    const uploadUrl = initResponse.headers.get("X-Goog-Upload-Url");
    if (!uploadUrl) {
      throw new Error("No upload URL received");
    }

    // Step 4: Upload the actual file bytes
    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "X-Goog-Api-Key": GEMINI_CONFIG.apiKey,
        "Content-Length": imageBytes.byteLength.toString(),
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
      },
      body: imageBytes,
    });

    if (!uploadResponse.ok) {
      throw new Error(`File upload failed: ${uploadResponse.statusText}`);
    }

    const uploadResult = await uploadResponse.json();

    return {
      uri: uploadResult.file.uri,
      mimeType: uploadResult.file.mimeType,
      category: category,
      originalPath: imageUrl,
      displayName: displayName,
    };
  } catch (error) {
    console.error(`Failed to upload image ${imageUrl}:`, error);
    return null;
  }
}

// Batch upload images to Gemini
async function batchUploadSupabaseImagesRest(
  images: ImageData[],
  concurrency: number = 3
): Promise<FileReference[]> {
  const uploadedFiles: FileReference[] = [];

  // Process images in batches to respect API limits
  for (let i = 0; i < images.length; i += concurrency) {
    const batch = images.slice(i, i + concurrency);

    const batchPromises = batch.map(async (image) => {
      try {
        let imageUrl: string;

        // Check if the path is already a full URL
        const imagePath = image.converted_path || image.path;
        if (
          imagePath.startsWith("http://") ||
          imagePath.startsWith("https://")
        ) {
          // Path is already a full URL, use it directly
          imageUrl = imagePath;
        } else {
          // Path is relative, get public URL from Supabase Storage
          const { data: publicUrlData } = supabase.storage
            .from("inspection-photos")
            .getPublicUrl(imagePath);

          if (!publicUrlData?.publicUrl) {
            console.error(`Failed to get public URL for ${imagePath}`);
            return null;
          }
          imageUrl = publicUrlData.publicUrl;
        }

        return await uploadImageToGeminiRest(
          imageUrl,
          image.category,
          image.id.toString()
        );
      } catch (error) {
        console.error(`Failed to process image ${image.path}:`, error);
        return null;
      }
    });

    const batchResults = await Promise.allSettled(batchPromises);

    // Collect successful uploads
    batchResults.forEach((result) => {
      if (result.status === "fulfilled" && result.value) {
        uploadedFiles.push(result.value);
      }
    });

    // Rate limiting delay between batches
    if (i + concurrency < images.length) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    console.log(
      `Uploaded batch ${Math.floor(i / concurrency) + 1}/${Math.ceil(
        images.length / concurrency
      )}`
    );
  }

  return uploadedFiles;
}

// Cleanup uploaded files from Gemini
async function cleanupGeminiFilesRest(fileUris: string[]): Promise<void> {
  for (const uri of fileUris) {
    try {
      // Extract file ID from URI (format: files/file_id)
      const fileId = uri.split("/").pop();
      if (!fileId) continue;

      const deleteResponse = await fetch(
        `${GEMINI_CONFIG.baseUrl}/v1beta/files/${fileId}`,
        {
          method: "DELETE",
          headers: {
            "X-Goog-Api-Key": GEMINI_CONFIG.apiKey,
          },
        }
      );

      if (!deleteResponse.ok) {
        console.warn(
          `Failed to delete file ${fileId}: ${deleteResponse.statusText}`
        );
      }
    } catch (error) {
      console.warn(`Error deleting file ${uri}:`, error);
    }
  }
}

// Send data to Dify Workflow API
async function sendToDifyAPI(
  inspectionId: string,
  uploadedFiles: FileReference[],
  vehicle_information: any
): Promise<void> {
  try {
    // const difyApiKey = Deno.env.get("DIFY_API_KEY");
    // if (!difyApiKey) {
    //   throw new Error("DIFY_API_KEY environment variable is not set");
    // }

    // Prepare inputs for Dify workflow
    const difyPayload = {
      inputs: {
        inspection_id: inspectionId,
        process_data: JSON.stringify(uploadedFiles),
        vehicle_information: JSON.stringify(vehicle_information),
      },
      response_mode: "streaming",
      user: `inspection_${inspectionId}`,
    };

    console.log("Sending data to Dify Workflow API:", {
      inspection_id: inspectionId,
      uploaded_files_count: uploadedFiles.length,
      vehicle_information: vehicle_information,
    });

    const difyResponse = await fetch("https://api.dify.ai/v1/workflows/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer app-zNmxCqT7QIptcDv5BpT1hEsa`,
      },
      body: JSON.stringify(difyPayload),
    });

    if (!difyResponse.ok) {
      const errorText = await difyResponse.text();
      throw new Error(`Dify Workflow API request failed: ${difyResponse.status} ${difyResponse.statusText} - ${errorText}`);
    }

    // Handle streaming response
    if (difyResponse.body) {
      const reader = difyResponse.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                
                // Handle different event types with detailed logging
                switch (data.event) {
                  case 'workflow_started':
                    console.log(`🚀 [WORKFLOW_STARTED] Inspection ${inspectionId}:`, {
                      workflow_run_id: data.workflow_run_id,
                      task_id: data.task_id,
                      workflow_id: data.data?.workflow_id,
                      created_at: data.data?.created_at,
                    });
                    break;

                  case 'node_started':
                    console.log(`🔄 [NODE_STARTED] Inspection ${inspectionId}:`, {
                      workflow_run_id: data.workflow_run_id,
                      task_id: data.task_id,
                      node_id: data.data?.node_id,
                      node_type: data.data?.node_type,
                      title: data.data?.title,
                      index: data.data?.index,
                      predecessor_node_id: data.data?.predecessor_node_id,
                      created_at: data.data?.created_at,
                    });
                    break;

                  case 'text_chunk':
                    console.log(`📝 [TEXT_CHUNK] Inspection ${inspectionId}:`, {
                      workflow_run_id: data.workflow_run_id,
                      task_id: data.task_id,
                      text: data.data?.text?.substring(0, 100) + (data.data?.text?.length > 100 ? '...' : ''),
                      from_variable_selector: data.data?.from_variable_selector,
                    });
                    break;

                  case 'node_finished':
                    console.log(`✅ [NODE_FINISHED] Inspection ${inspectionId}:`, {
                      workflow_run_id: data.workflow_run_id,
                      task_id: data.task_id,
                      node_id: data.data?.node_id,
                      node_type: data.data?.node_type,
                      title: data.data?.title,
                      index: data.data?.index,
                      status: data.data?.status,
                      elapsed_time: data.data?.elapsed_time,
                      total_tokens: data.data?.execution_metadata?.total_tokens,
                      total_price: data.data?.execution_metadata?.total_price,
                      currency: data.data?.execution_metadata?.currency,
                      error: data.data?.error,
                    });
                    break;

                  case 'workflow_finished':
                    console.log(`🏁 [WORKFLOW_FINISHED] Inspection ${inspectionId}:`, {
                      workflow_run_id: data.workflow_run_id,
                      task_id: data.task_id,
                      workflow_id: data.data?.workflow_id,
                      status: data.data?.status,
                      elapsed_time: data.data?.elapsed_time,
                      total_tokens: data.data?.total_tokens,
                      total_steps: data.data?.total_steps,
                      outputs: data.data?.outputs,
                      error: data.data?.error,
                      created_at: data.data?.created_at,
                      finished_at: data.data?.finished_at,
                    });
                    
                    // Update inspection record with workflow completion
                    const { error: updateError } = await supabase
                      .from("inspections")
                      .update({
                        updated_at: new Date().toISOString(),
                        workflow_run_id: data.workflow_run_id,
                      })
                      .eq("id", inspectionId);

                    if (updateError) {
                      console.warn("❌ Failed to update inspection record:", updateError);
                    } else {
                      console.log(`✅ Updated inspection ${inspectionId} with workflow completion`);
                    }
                    break;

                  case 'tts_message':
                    console.log(`🔊 [TTS_MESSAGE] Inspection ${inspectionId}:`, {
                      workflow_run_id: data.workflow_run_id,
                      task_id: data.task_id,
                      message_id: data.message_id,
                      audio_length: data.audio?.length || 0,
                      created_at: data.created_at,
                    });
                    break;

                  case 'tts_message_end':
                    console.log(`🔇 [TTS_MESSAGE_END] Inspection ${inspectionId}:`, {
                      workflow_run_id: data.workflow_run_id,
                      task_id: data.task_id,
                      message_id: data.message_id,
                      created_at: data.created_at,
                    });
                    break;

                  case 'ping':
                    console.log(`💓 [PING] Inspection ${inspectionId}: Connection keepalive`);
                    break;

                  default:
                    console.log(`❓ [UNKNOWN_EVENT] Inspection ${inspectionId}:`, {
                      event: data.event,
                      workflow_run_id: data.workflow_run_id,
                      task_id: data.task_id,
                      data: data.data,
                    });
                    break;
                }
              } catch (parseError) {
                console.warn(`⚠️ Failed to parse streaming data for inspection ${inspectionId}:`, {
                  error: parseError.message,
                  line: line.substring(0, 200) + (line.length > 200 ? '...' : ''),
                });
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    }

    console.log(`Successfully initiated Dify workflow for inspection ${inspectionId}`);

  } catch (error) {
    console.error(`Error sending data to Dify Workflow API for inspection ${inspectionId}:`, error);
    throw error;
  }
}

// Main Gemini processing function (replaces chunk processing)
async function processGeminiAnalysisRest(
  inspectionId: string
): Promise<void> {
  let uploadedFiles: FileReference[] = [];

  try {

    // Get job and inspection data
    const { data: inspectionData, error: inspectionError } = await supabase
      .from("inspections")
      .select(
        `
        id, vin, mileage, zip,
        photos(*),
        obd2_codes:obd2_codes(*),
        title_images:title_images(*)
      `
      )
      .eq("id", inspectionId)
      .single();

    console.log("INSPECTION DATA : ", inspectionData);
    console.log("INSPECTION ERROR : ", inspectionError);

    if (inspectionError || !inspectionData) {
      throw new Error("Failed to fetch inspection data");
    }

    // Combine all images
    const allImages: ImageData[] = [
      ...inspectionData.photos.map((p: any) => ({
        ...p,
        category: p.category,
      })),
      ...inspectionData.obd2_codes
        .filter((o: any) => o.image_path)
        .map((o: any) => ({
          ...o,
          category: "obd",
          path: o.image_path,
          converted_path: o.converted_path,
        })),
      ...inspectionData.title_images.map((t: any) => ({
        ...t,
        category: "title",
      })),
    ];

    console.log(
      `Processing ${allImages.length} images for inspection ${inspectionId}`
    );

    // Upload all images to Gemini Files API
    uploadedFiles = await batchUploadSupabaseImagesRest(allImages, 3);

    console.log("UPLOADED FILES : ", uploadedFiles);

    if (uploadedFiles.length === 0) {
      throw new Error("No images were successfully uploaded to Gemini");
    }

    console.log(
      `Successfully uploaded ${uploadedFiles.length}/${allImages.length} images to Gemini`
    );

    // Prepare vehicle information object
    const vehicle_information = {
      vin: inspectionData.vin,
      mileage: inspectionData.mileage,
      zip: inspectionData.zip,
      vinHistory: null,
      marketPriceBands: null,
    };

    // Start Dify workflow in background process
    EdgeRuntime.waitUntil(sendToDifyAPI(inspectionId, uploadedFiles, vehicle_information));

    console.log(
      `Successfully completed Gemini analysis and started Dify workflow for inspection ${inspectionId}`
    );
  } catch (error) {

    console.error(`Error processing Gemini analysis for inspection ${inspectionId}:`, error);
    throw new Error(`Failed to process Gemini analysis: ${error.message}`);
  } finally {
    // Always cleanup uploaded files
    if (uploadedFiles.length > 0) {
      const fileUris = uploadedFiles.map((f) => f.uri);
      await cleanupGeminiFilesRest(fileUris);
      console.log(`Cleaned up ${fileUris.length} uploaded files from Gemini`);
    }
  }
}
// Main serve function
serve(async (req) => {
  try {
    console.log("Process next chunk request received");
    // Parse the request payload
    const payload = await req.json();
    const {
      inspection_id: inspectionId,
      completed_sequence: completedSequence,
    } = payload;

    // Start background processing for Gemini analysis
    EdgeRuntime.waitUntil(processGeminiAnalysisRest(inspectionId));

    // Return success response
    return new Response(
      JSON.stringify({
        message: "Processing started for inspection",
        inspectionId: inspectionId,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }
});
