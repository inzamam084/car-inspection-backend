/**
 * Utility functions for the process-next-chunk function
 */

import {
  supabase,
  GEMINI_CONFIG,
  STORAGE_CONFIG,
  PROCESSING_CONFIG,
} from "./config.ts";
import type {
  ImageData,
  FileReference,
  GeminiContentPart,
  GeminiRequestBody,
  OBD2CodeData,
  VehicleInformation,
} from "./schemas.ts";

/**
 * Build content structure for Gemini API
 */
export function buildGeminiContentRest(
  systemPrompt: string,
  dataBlock: VehicleInformation,
  obd2Codes: OBD2CodeData[],
  uploadedFiles: FileReference[]
): { parts: GeminiContentPart[] } {
  const parts: GeminiContentPart[] = [];

  // Add system prompt
  parts.push({ text: systemPrompt });

  // Add data block
  if (dataBlock) {
    parts.push({
      text: `DATA_BLOCK: ${JSON.stringify(dataBlock)}`,
    });
  }

  // Add OBD2 codes
  for (const code of obd2Codes) {
    if (code.code) {
      parts.push({
        text: `Code: ${code.code}\nDescription: ${code.description || ""}`,
      });
    }
  }

  // Add file references grouped by category
  for (const file of uploadedFiles) {
    parts.push({
      text: `Category: ${file.category}`,
    });
    parts.push({
      file_data: {
        mime_type: file.mimeType,
        file_uri: file.uri,
      },
    });
  }

  return { parts };
}

/**
 * Build complete Gemini request body with schema
 */
export function buildGeminiRequestBodyRest(
  systemPrompt: string,
  dataBlock: VehicleInformation,
  obd2Codes: OBD2CodeData[],
  uploadedFiles: FileReference[],
  schema: any
): GeminiRequestBody {
  // Build content parts
  const contents = buildGeminiContentRest(
    systemPrompt,
    dataBlock,
    obd2Codes,
    uploadedFiles
  );

  // Return complete request body
  return {
    contents: [contents],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
      temperature: 0.1,
    },
  };
}

/**
 * Validate Gemini API key by making a simple API call
 */
export async function validateGeminiApiKey(): Promise<boolean> {
  try {
    if (!GEMINI_CONFIG.apiKey) {
      console.error("❌ GEMINI_API_KEY environment variable is not set");
      return false;
    }

    // Test API key with a simple models list request
    const testResponse = await fetch(
      `${GEMINI_CONFIG.baseUrl}/v1beta/models`,
      {
        method: "GET",
        headers: {
          "x-goog-api-key": GEMINI_CONFIG.apiKey,
        },
      }
    );

    if (!testResponse.ok) {
      const errorText = await testResponse.text();
      console.error(`❌ Gemini API key validation failed: ${testResponse.status} ${testResponse.statusText} - ${errorText}`);
      return false;
    }

    console.log("✅ Gemini API key is valid");
    return true;
  } catch (error) {
    console.error("❌ Error validating Gemini API key:", error);
    return false;
  }
}

/**
 * Upload single image to Gemini Files API
 */
export async function uploadImageToGeminiRest(
  imageUrl: string,
  category: string,
  imageId: string
): Promise<FileReference | null> {
  try {
    // Validate API key first
    if (!GEMINI_CONFIG.apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is not set");
    }

    // Step 1: Fetch image from Supabase public URL
    console.log(`📥 Fetching image from: ${imageUrl}`);
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch image: ${imageResponse.statusText}`);
    }

    const imageBlob = await imageResponse.blob();
    const imageBytes = await imageBlob.arrayBuffer();
    const mimeType = imageBlob.type || "image/jpeg";
    const displayName = `${category}_${imageId}_${Date.now()}`;

    console.log(`📤 Uploading image: ${displayName} (${imageBytes.byteLength} bytes, ${mimeType})`);

    // Step 2: Initial resumable upload request
    const initResponse = await fetch(GEMINI_CONFIG.uploadUrl, {
      method: "POST",
      headers: {
        "x-goog-api-key": GEMINI_CONFIG.apiKey,
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
      const errorText = await initResponse.text();
      console.error(`❌ Upload init failed for ${displayName}:`, {
        status: initResponse.status,
        statusText: initResponse.statusText,
        error: errorText,
        apiKeyPresent: !!GEMINI_CONFIG.apiKey,
        apiKeyLength: GEMINI_CONFIG.apiKey?.length || 0,
      });
      throw new Error(`Upload init failed: ${initResponse.status} ${initResponse.statusText} - ${errorText}`);
    }

    // Step 3: Get upload URL from response headers
    const uploadUrl = initResponse.headers.get("x-goog-upload-url");
    if (!uploadUrl) {
      console.error(`❌ No upload URL received for ${displayName}`);
      throw new Error("No upload URL received");
    }

    console.log(`🔗 Got upload URL for ${displayName}`);

    // Step 4: Upload the actual file bytes
    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "x-goog-api-key": GEMINI_CONFIG.apiKey,
        "Content-Length": imageBytes.byteLength.toString(),
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
      },
      body: imageBytes,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error(`❌ File upload failed for ${displayName}:`, {
        status: uploadResponse.status,
        statusText: uploadResponse.statusText,
        error: errorText,
      });
      throw new Error(`File upload failed: ${uploadResponse.status} ${uploadResponse.statusText} - ${errorText}`);
    }

    const uploadResult = await uploadResponse.json();
    console.log(`✅ Successfully uploaded ${displayName} to Gemini`);

    // Step 5: Save the Gemini file ID to the photos table
    try {
      const geminiFileId = uploadResult.file.name; // Extract file ID from the response
      console.log(`💾 Saving Gemini file ID ${geminiFileId} to photos table for image ${imageId}`);
      
      const { error: updateError } = await supabase
        .from("photos")
        .update({ image_id: geminiFileId })
        .eq("id", imageId);

      if (updateError) {
        console.error(`❌ Failed to update photos table with image_id for ${imageId}:`, updateError);
        // Don't throw error here as the upload was successful, just log the warning
      } else {
        console.log(`✅ Successfully saved image_id ${geminiFileId} to photos table for image ${imageId}`);
      }
    } catch (dbError) {
      console.error(`❌ Database error while saving image_id for ${imageId}:`, dbError);
      // Don't throw error here as the upload was successful
    }

    return {
      uri: uploadResult.file.uri,
      mimeType: uploadResult.file.mimeType,
      category: category,
      originalPath: imageUrl,
      displayName: displayName,
    };
  } catch (error) {
    console.error(`❌ Failed to upload image ${imageUrl}:`, error);
    return null;
  }
}

/**
 * Batch upload images to Gemini with concurrency control
 */
export async function batchUploadSupabaseImagesRest(
  images: ImageData[],
  concurrency: number = PROCESSING_CONFIG.maxConcurrentUploads
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
            .from(STORAGE_CONFIG.bucketName)
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
      await new Promise((resolve) =>
        setTimeout(resolve, PROCESSING_CONFIG.batchDelayMs)
      );
    }

    console.log(
      `Uploaded batch ${Math.floor(i / concurrency) + 1}/${Math.ceil(
        images.length / concurrency
      )}`
    );
  }

  return uploadedFiles;
}

/**
 * Get inspection data from database
 */
export async function getInspectionData(inspectionId: string) {
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

  if (inspectionError || !inspectionData) {
    throw new Error(
      `Failed to fetch inspection data: ${inspectionError?.message}`
    );
  }

  return inspectionData;
}

/**
 * Combine all images from different sources
 */
export function combineAllImages(inspectionData: any): ImageData[] {
  return [
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
}

/**
 * Create vehicle information object
 */
export function createVehicleInformation(
  inspectionData: any
): VehicleInformation {
  return {
    vin: inspectionData.vin,
    mileage: inspectionData.mileage,
    zip: inspectionData.zip,
    vinHistory: null,
    marketPriceBands: null,
  };
}

/**
 * Update inspection with workflow run ID
 */
export async function updateInspectionWorkflowId(
  inspectionId: string,
  workflowRunId: string
): Promise<void> {
  const { error: updateError } = await supabase
    .from("inspections")
    .update({
      workflow_run_id: workflowRunId,
    })
    .eq("id", inspectionId);

  if (updateError) {
    console.warn("❌ Failed to update inspection record:", updateError);
    throw new Error(`Failed to update inspection: ${updateError.message}`);
  }

  console.log(`✅ Updated inspection ${inspectionId} with workflow completion`);
}

/**
 * Sleep utility for rate limiting
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
