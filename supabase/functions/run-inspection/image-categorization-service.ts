import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { supabase } from "./config.ts";
import { createDatabaseService } from "../shared/database-service.ts";
import type {
  Photo,
  ImageCategorizationResult,
} from "./schemas.ts";

// Initialize database service
const dbService = createDatabaseService();

/**
 * Categorize a single image using function-call edge function
 */
export async function categorizeImage(
  imageUrl: string
): Promise<ImageCategorizationResult | null> {
  try {
    console.log(`Categorizing image: ${imageUrl}`);

    // Prepare the request payload for function-call edge function
    const functionCallPayload = {
      function_name: "image_categorization",
      query: "Provide the results with the image url",
      files: [
        {
          type: "image",
          transfer_method: "remote_url",
          url: imageUrl,
        },
      ],
    };

    // Get Supabase URL and service key for internal function call
    // @ts-ignore: Deno global is available in Supabase Edge Functions
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    // @ts-ignore: Deno global is available in Supabase Edge Functions
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Missing Supabase configuration for function call");
      return null;
    }

    // Call the function-call edge function
    const response = await fetch(`${supabaseUrl}/functions/v1/function-call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify(functionCallPayload),
    });

    if (!response.ok) {
      console.error(
        `Function-call request failed: ${response.status} ${response.statusText}`
      );
      const errorText = await response.text();
      console.error("Error response:", errorText);
      return null;
    }

    const data = await response.json();
    console.log(`Function-call response for ${imageUrl}:`, data);

    if (!data.success || !data.payload) {
      console.error("Function-call returned unsuccessful response:", data);
      return null;
    }

    // Parse the JSON response from the payload field
    try {
      // Extract JSON from the response that may contain explanatory text
      let jsonString = data.payload;
      
      // Look for JSON block between ```json and ``` markers
      const jsonMatch = jsonString.match(/```json\s*\n([\s\S]*?)\n\s*```/);
      if (jsonMatch) {
        jsonString = jsonMatch[1];
      } else {
        // If no markdown code block, try to find JSON object directly
        const jsonObjectMatch = jsonString.match(/\{[\s\S]*\}/);
        if (jsonObjectMatch) {
          jsonString = jsonObjectMatch[0];
        }
      }

      const answerJson = JSON.parse(jsonString.trim());

      const result: ImageCategorizationResult = {
        category: answerJson.category,
        confidence: answerJson.confidence || 1.0,
        reasoning: answerJson.reasoning || "No reasoning provided",
      };

      console.log(
        `Image categorized as: ${result.category} (confidence: ${result.confidence})`
      );
      return result;
    } catch (parseError) {
      console.error("Failed to parse function-call response:", parseError);
      console.error("Raw payload:", data.payload);
      return null;
    }
  } catch (error) {
    console.error(`Error categorizing image ${imageUrl}:`, error);
    return null;
  }
}

/**
 * Categorize multiple images in batch
 */
export async function categorizeImages(photos: Photo[]): Promise<void> {
  console.log(`Starting categorization for ${photos.length} images`);

  const categorizePromises = photos.map(async (photo) => {
    try {
      // Get the full URL for the image
      // const imageUrl = getFullImageUrl(photo.converted_path || photo.path);

      const result = await categorizeImage(photo.path);

      if (result) {
        // Update the photo category in the database
        await updatePhotoCategory(photo.id, result.category);
        console.log(
          `Updated photo ${photo.id} with category: ${result.category}`
        );
      } else {
        console.warn(
          `Failed to categorize photo ${photo.id}, keeping existing category: ${photo.category}`
        );
      }
    } catch (error) {
      console.error(`Error processing photo ${photo.id}:`, error);
    }
  });

  // Process images with some concurrency but not too many at once to avoid rate limits
  const batchSize = 3;
  for (let i = 0; i < categorizePromises.length; i += batchSize) {
    const batch = categorizePromises.slice(i, i + batchSize);
    await Promise.all(batch);

    // Add a small delay between batches to be respectful to the API
    if (i + batchSize < categorizePromises.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  console.log(`Completed categorization for ${photos.length} images`);
}

/**
 * Update photo category in the database
 */
async function updatePhotoCategory(
  photoId: string,
  category: string
): Promise<void> {
  try {
    const { error } = await dbService
      .getClient()
      .from("photos")
      .update({ category })
      .eq("id", photoId);

    if (error) {
      console.error(`Failed to update category for photo ${photoId}:`, error);
      throw error;
    }
  } catch (error) {
    console.error(`Error updating photo category:`, error);
    throw error;
  }
}

/**
 * Get full image URL from path
 */
function getFullImageUrl(path: string): string {
  // If it's already a full URL, return as is
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  // If it's a Supabase storage path, construct the full URL
  if (path.startsWith("inspection-photos/")) {
    // @ts-ignore: Deno global is available in Supabase Edge Functions
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    return `${supabaseUrl}/storage/v1/object/public/${path}`;
  }

  // Default case - assume it's a relative path to Supabase storage
  // @ts-ignore: Deno global is available in Supabase Edge Functions
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  return `${supabaseUrl}/storage/v1/object/public/inspection-photos/${path}`;
}
