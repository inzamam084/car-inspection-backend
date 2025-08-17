import { DIFY_API_CONFIG } from "./config.ts";
import { createDatabaseService } from "../shared/database-service.ts";
import type {
  Photo,
  ImageCategorizationResult,
  DifyApiRequest,
  DifyApiResponse,
} from "./schemas.ts";

// Initialize database service
const dbService = createDatabaseService();

/**
 * Categorize a single image using Dify API
 */
export async function categorizeImage(
  imageUrl: string
): Promise<ImageCategorizationResult | null> {
  try {
    console.log(`Categorizing image: ${imageUrl}`);

    // if (!DIFY_API_CONFIG.apiKey) {
    //   console.error("DIFY_API_KEY is not configured");
    //   return null;
    // }

    const requestBody: DifyApiRequest = {
      inputs: {
        query: "Provide the results with the image url",
      },
      response_mode: "blocking",
      user: "car-inspection-system",
      files: [
        {
          type: "image",
          transfer_method: "remote_url",
          url: imageUrl,
        },
      ],
    };

    const response = await fetch(DIFY_API_CONFIG.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Authorization: `Bearer ${DIFY_API_CONFIG.apiKey}`,
        Authorization: `Bearer app-jL9rbqp3bp4MABfC1lZcfNLE`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      console.error(
        `Dify API request failed: ${response.status} ${response.statusText}`
      );
      const errorText = await response.text();
      console.error("Error response:", errorText);
      return null;
    }

    const data: DifyApiResponse = await response.json();
    console.log(`Dify API response for ${imageUrl}:`, data);

    // Parse the JSON response from the answer field
    try {
      const answerJson = JSON.parse(
        data.answer.replace(/```json\n|\n```/g, "")
      );

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
      console.error("Failed to parse Dify API response:", parseError);
      console.error("Raw answer:", data.answer);
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    return `${supabaseUrl}/storage/v1/object/public/${path}`;
  }

  // Default case - assume it's a relative path to Supabase storage
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  return `${supabaseUrl}/storage/v1/object/public/inspection-photos/${path}`;
}
