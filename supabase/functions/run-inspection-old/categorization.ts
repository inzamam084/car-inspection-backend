import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { supabase } from "./config.ts";
import { createDatabaseService } from "../shared-old/database-service.ts";
import type {
  Photo,
  ImageCategorizationResult,
} from "./schemas.ts";

// Retry configuration for image categorization
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000, // Start with 1 second
  maxDelayMs: 10000, // Cap at 10 seconds
  backoffMultiplier: 2,
};

// Helper function for retry with exponential backoff
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  operationName: string,
  config = RETRY_CONFIG
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = Math.min(
          config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt - 1),
          config.maxDelayMs
        );
        
        console.log(`Retrying ${operationName}`, {
          attempt: attempt + 1,
          maxRetries: config.maxRetries + 1,
          delayMs: delay,
        });
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === config.maxRetries) {
        console.error(`${operationName} failed after ${config.maxRetries + 1} attempts`, {
          error: lastError.message,
          totalAttempts: attempt + 1,
        });
        throw lastError;
      }
      
      console.warn(`${operationName} failed, will retry`, {
        attempt: attempt + 1,
        error: lastError.message,
        nextRetryIn: Math.min(
          config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt),
          config.maxDelayMs
        ),
      });
    }
  }
  
  throw lastError!;
}

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
      function_name: "image_details_extraction",
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

    // Call the function-call edge function with retry logic
    let data;
    try {
      data = await retryWithBackoff(
        async () => {
          const response = await fetch(`${supabaseUrl}/functions/v1/function-call-old`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify(functionCallPayload),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
          }

          const data = await response.json();
          
          if (!data.success || !data.payload) {
            throw new Error(`Function call failed: ${JSON.stringify(data)}`);
          }
          
          return data;
        },
        `image categorization for ${imageUrl}`
      );
      
      console.log(`Function-call response for ${imageUrl}:`, data);
    } catch (error) {
      console.warn(`Image categorization failed after retries for ${imageUrl}, skipping`, {
        error: (error as Error).message,
      });
      return null;
    }

    // Parse the JSON response from the payload field
    try {
      // Extract JSON from the response that may contain explanatory text
      let jsonString = data.payload;
      console.log("Raw function-call payload:", jsonString);
      
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

      // Create a copy of the analysis without vehicle data for fullAnalysis
      const analysisWithoutVehicle = { ...answerJson };
      delete analysisWithoutVehicle.vehicle;

      const result: ImageCategorizationResult = {
        category: answerJson.inspectionResult?.category || answerJson.category || "exterior",
        confidence: answerJson.confidence || 1.0,
        reasoning: answerJson.reasoning || "No reasoning provided",
        fullAnalysis: analysisWithoutVehicle,
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
      const result = await categorizeImage(photo.path);
      if (result) {
        await updatePhotoWithAnalysis(photo.id, result.category, result.fullAnalysis);
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
 * Update photo category and LLM analysis in the database
 */
async function updatePhotoWithAnalysis(
  photoId: string,
  category: string,
  llmAnalysis?: any
): Promise<void> {
  try {
    const updateData: any = { category };

    // Add llm_analysis if provided
    if (llmAnalysis) {
      updateData.llm_analysis = llmAnalysis;
    }

    const { error } = await dbService
      .getClient()
      .from("photos")
      .update(updateData)
      .eq("id", photoId);

    if (error) {
      console.error(`Failed to update photo ${photoId}:`, error);
      throw error;
    }

    console.log(
      `Successfully updated photo ${photoId} with category: ${category} and LLM analysis`
    );
  } catch (error) {
    console.error(`Error updating photo with analysis:`, error);
    throw error;
  }
}
