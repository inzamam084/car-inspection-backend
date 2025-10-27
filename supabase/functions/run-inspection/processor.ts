import { APP_BASE_URL, SUPABASE_CONFIG } from "./config.ts";
import { Database } from "./database.ts";
import type { Inspection, Photo, OBD2Code, TitleImage } from "./schemas.ts";
import { RequestContext } from "./logging.ts";

// Retry configuration for image categorization
interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

const CATEGORIZE_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3, // Total of 4 attempts (initial + 3 retries)
  baseDelayMs: 1000, // Start with 1 second
  maxDelayMs: 10000, // Cap at 10 seconds
  backoffMultiplier: 2, // Exponential backoff: 1s, 2s, 4s
};

/**
 * Determine if an error is retryable based on HTTP status or error type
 */
function isRetryableError(error: unknown, httpStatus?: number): boolean {
  // Retry on 5xx server errors
  if (httpStatus && httpStatus >= 500) {
    return true;
  }

  // Retry on specific error patterns
  const errorMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  
  const retryablePatterns = [
    "timeout",
    "timed out",
    "network",
    "econnreset",
    "econnrefused",
    "socket hang up",
    "temporary",
    "unavailable",
    "502 bad gateway",
    "503 service unavailable",
    "504 gateway timeout",
    "boot_error",
    "function failed to start",
  ];

  return retryablePatterns.some(pattern => errorMessage.includes(pattern));
}

/**
 * Execute an operation with exponential backoff retry logic
 */
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  operationName: string,
  ctx?: RequestContext,
  config: RetryConfig = CATEGORIZE_RETRY_CONFIG
): Promise<{ result: T; attempts: number }> {
  let lastError: Error;
  let attempt = 0;

  while (attempt <= config.maxRetries) {
    try {
      if (attempt > 0) {
        const delay = Math.min(
          config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt - 1),
          config.maxDelayMs
        );

        if (ctx) {
          ctx.info(`Retrying ${operationName}`, {
            attempt: attempt + 1,
            total_attempts: config.maxRetries + 1,
            delay_ms: delay,
          });
        } else {
          console.log(`Retrying ${operationName} (attempt ${attempt + 1}/${config.maxRetries + 1}) after ${delay}ms`);
        }

        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      const result = await operation();
      
      if (attempt > 0) {
        if (ctx) {
          ctx.info(`${operationName} succeeded after ${attempt + 1} attempts`);
        } else {
          console.log(`✅ ${operationName} succeeded after ${attempt + 1} attempts`);
        }
      }
      
      return { result, attempts: attempt + 1 };
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      attempt++;

      // Extract HTTP status if available
      const httpStatus = error && typeof error === 'object' && 'httpStatus' in error
        ? (error as { httpStatus: number }).httpStatus
        : undefined;
      const shouldRetry = isRetryableError(error, httpStatus);

      if (attempt > config.maxRetries) {
        if (ctx) {
          ctx.error(
            `${operationName} failed after ${attempt} attempts`,
            {
              error: lastError.message,
              total_attempts: attempt,
            }
          );
        } else {
          console.error(`❌ ${operationName} failed after ${attempt} attempts:`, lastError.message);
        }
        throw lastError;
      }

      if (!shouldRetry) {
        if (ctx) {
          ctx.warn(
            `${operationName} failed with non-retryable error`,
            {
              error: lastError.message,
              attempt,
            }
          );
        } else {
          console.warn(`⚠️  ${operationName} failed with non-retryable error:`, lastError.message);
        }
        throw lastError;
      }

      if (ctx) {
        ctx.warn(`${operationName} failed, will retry`, {
          attempt,
          error: lastError.message,
          next_retry_in_ms: Math.min(
            config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt - 1),
            config.maxDelayMs
          ),
        });
      } else {
        console.warn(`⚠️  ${operationName} failed, will retry:`, lastError.message);
      }
    }
  }

  throw lastError!;
}

/**
 * Categorize images by calling the categorize-image endpoint concurrently
 */
async function categorizeImagesConcurrently(
  photos: Photo[],
  inspectionId: string,
  obd2Codes: OBD2Code[],
  titleImages: TitleImage[],
  inspectionType: string,
  userId?: string,
  ctx?: RequestContext
): Promise<void> {
  const startTime = Date.now();
  const totalImages =
    photos.length + (obd2Codes?.length || 0) + (titleImages?.length || 0);

  if (ctx) {
    ctx.info("Starting concurrent image categorization", {
      photos_count: photos.length,
      obd2_count: obd2Codes?.length || 0,
      title_images_count: titleImages?.length || 0,
      total_images: totalImages,
    });
  } else {
    console.log(
      `Starting concurrent image categorization for ${totalImages} images`
    );
  }

  const categorizePromises: Promise<any>[] = [];

  // Process regular photos
  photos.forEach((photo, index) => {
    categorizePromises.push(
      (async () => {
        try {
          // Use retry logic for categorization
          const { result, attempts } = await retryWithBackoff(
            async () => {
              const response = await fetch(
                `${SUPABASE_CONFIG.url}/functions/v1/categorize-image`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${SUPABASE_CONFIG.serviceKey}`,
                  },
                  body: JSON.stringify({
                    image_url: photo.path,
                    image_id: photo.id,
                    image_type: "photo",
                    inspection_id: inspectionId,
                    user_id: userId,
                    inspection_type: inspectionType,
                  }),
                }
              );

              if (!response.ok) {
                const errorText = await response.text();
                const error = new Error(
                  `Categorize-image failed: HTTP ${response.status}: ${errorText}`
                ) as Error & { httpStatus: number };
                error.httpStatus = response.status;
                throw error;
              }

              return await response.json();
            },
            `categorize photo ${photo.id}`,
            ctx
          );

          if (ctx) {
            ctx.debug(`Photo ${index + 1}/${photos.length} categorized`, {
              photo_id: photo.id,
              category: result.category,
              duration_ms: result.duration_ms,
              attempts,
            });
          } else {
            console.log(
              `✅ Photo ${index + 1}/${photos.length} categorized as: ${
                result.category
              } (${attempts} attempt${attempts > 1 ? 's' : ''})`
            );
          }

          return { success: true, ...result, attempts };
        } catch (error) {
          if (ctx) {
            ctx.error(`Failed to categorize photo ${photo.id}`, {
              error: (error as Error).message,
            });
          } else {
            console.error(
              `❌ Failed to categorize photo ${photo.id}:`,
              (error as Error).message
            );
          }
          return { success: false, error: (error as Error).message };
        }
      })()
    );
  });

  // Process OBD2 codes with images
  if (obd2Codes) {
    const obd2ImagesWithScreenshots = obd2Codes.filter(
      (obd2) => obd2.code === "IMG" && obd2.screenshot_path
    );

    if (ctx) {
      ctx.info(
        `Found ${obd2ImagesWithScreenshots.length} OBD2 codes with images to process`
      );
    }

    obd2ImagesWithScreenshots.forEach((obd2, index) => {
      categorizePromises.push(
        (async () => {
          try {
            // Use retry logic for categorization
            const { result, attempts } = await retryWithBackoff(
              async () => {
                const response = await fetch(
                  `${SUPABASE_CONFIG.url}/functions/v1/categorize-image`,
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${SUPABASE_CONFIG.serviceKey}`,
                    },
                    body: JSON.stringify({
                      image_url: obd2.screenshot_path,
                      image_id: obd2.id,
                      image_type: "obd2",
                      inspection_id: inspectionId,
                      user_id: userId,
                      inspection_type: inspectionType,
                    }),
                  }
                );

                if (!response.ok) {
                  const errorText = await response.text();
                  const error = new Error(
                    `Categorize-image failed: HTTP ${response.status}: ${errorText}`
                  ) as Error & { httpStatus: number };
                  error.httpStatus = response.status;
                  throw error;
                }

                return await response.json();
              },
              `categorize OBD2 ${obd2.id}`,
              ctx
            );

            if (ctx) {
              ctx.debug(
                `OBD2 ${index + 1}/${
                  obd2ImagesWithScreenshots.length
                } categorized`,
                {
                  obd2_id: obd2.id,
                  duration_ms: result.duration_ms,
                  attempts,
                }
              );
            } else {
              console.log(
                `✅ OBD2 ${index + 1}/${
                  obd2ImagesWithScreenshots.length
                } categorized (${attempts} attempt${attempts > 1 ? 's' : ''})`
              );
            }

            return { success: true, ...result, attempts };
          } catch (error) {
            if (ctx) {
              ctx.error(`Failed to categorize OBD2 code ${obd2.id}`, {
                error: (error as Error).message,
              });
            } else {
              console.error(
                `❌ Failed to categorize OBD2 ${obd2.id}:`,
                (error as Error).message
              );
            }
            return { success: false, error: (error as Error).message };
          }
        })()
      );
    });
  }

  // Process title images
  if (titleImages) {
    if (ctx) {
      ctx.info(`Processing ${titleImages.length} title images`);
    }

    titleImages.forEach((titleImage, index) => {
      categorizePromises.push(
        (async () => {
          try {
            // Use retry logic for categorization
            const { result, attempts } = await retryWithBackoff(
              async () => {
                const response = await fetch(
                  `${SUPABASE_CONFIG.url}/functions/v1/categorize-image`,
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${SUPABASE_CONFIG.serviceKey}`,
                    },
                    body: JSON.stringify({
                      image_url: titleImage.path,
                      image_id: titleImage.id,
                      image_type: "title",
                      inspection_id: inspectionId,
                      user_id: userId,
                      inspection_type: inspectionType,
                    }),
                  }
                );

                if (!response.ok) {
                  const errorText = await response.text();
                  const error = new Error(
                    `Categorize-image failed: HTTP ${response.status}: ${errorText}`
                  ) as Error & { httpStatus: number };
                  error.httpStatus = response.status;
                  throw error;
                }

                return await response.json();
              },
              `categorize title image ${titleImage.id}`,
              ctx
            );

            if (ctx) {
              ctx.debug(
                `Title image ${index + 1}/${titleImages.length} categorized`,
                {
                  title_image_id: titleImage.id,
                  duration_ms: result.duration_ms,
                  attempts,
                }
              );
            } else {
              console.log(
                `✅ Title image ${index + 1}/${titleImages.length} categorized (${attempts} attempt${attempts > 1 ? 's' : ''})`
              );
            }

            return { success: true, ...result, attempts };
          } catch (error) {
            if (ctx) {
              ctx.error(`Failed to categorize title image ${titleImage.id}`, {
                error: (error as Error).message,
              });
            } else {
              console.error(
                `❌ Failed to categorize title image ${titleImage.id}:`,
                (error as Error).message
              );
            }
            return { success: false, error: (error as Error).message };
          }
        })()
      );
    });
  }

  // Execute all categorization requests concurrently
  const results = await Promise.allSettled(categorizePromises);

  // Process results
  const successCount = results.filter(
    (r) => r.status === "fulfilled" && r.value.success
  ).length;
  const failureCount = results.filter(
    (r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.success)
  ).length;

  const duration = Date.now() - startTime;

  if (ctx) {
    ctx.info("Concurrent image categorization completed", {
      total_images: totalImages,
      successful: successCount,
      failed: failureCount,
      duration_ms: duration,
      avg_per_image_ms: Math.round(duration / totalImages),
    });
  } else {
    console.log(
      `\n📊 Categorization Summary:\n` +
        `✅ Successful: ${successCount}\n` +
        `❌ Failed: ${failureCount}\n` +
        `📁 Total: ${totalImages}\n` +
        `⏱️  Duration: ${Math.round(duration / 1000)}s\n` +
        `🚀 Avg per image: ${Math.round(duration / totalImages)}ms`
    );
  }
}

// Background analysis function
export async function runAnalysisInBackground(
  inspectionId: string,
  ctx: RequestContext
): Promise<void> {
  try {
    ctx.info("Starting background analysis", { inspection_id: inspectionId });

    // Update status to processing
    ctx.debug("Updating inspection status to processing");
    await Database.updateInspectionStatus(inspectionId, "processing");

    // Batch fetch all inspection data in a single query
    ctx.debug("Fetching inspection data from database");
    const { data: inspectionData, error: inspectionError } =
      await Database.batchFetchInspectionData(inspectionId);

    if (inspectionError || !inspectionData) {
      ctx.error("Error fetching inspection data", {
        error: inspectionError?.message,
      });
      await Database.updateInspectionStatus(inspectionId, "failed");
      return;
    }

    // Extract data from the batched result
    var photos = inspectionData.photos || [];
    var obd2_codes = inspectionData.obd2_codes || [];
    var title_images = inspectionData.title_images || [];

    if (photos.length === 0) {
      ctx.error("No photos found for inspection");
      await Database.updateInspectionStatus(inspectionId, "failed");
      return;
    }

    ctx.info("Inspection data retrieved successfully", {
      photos_count: photos.length,
      obd2_codes_count: obd2_codes.length,
      title_images_count: title_images.length,
      inspection_type: inspectionData.type,
    });

    // Categorize images using concurrent calls to categorize-image endpoint
    if (
      inspectionData.type !== "url" &&
      (photos.length > 0 || obd2_codes.length > 0 || title_images.length > 0)
    ) {
      const totalImages =
        photos.length + obd2_codes.length + title_images.length;
      ctx.info("Starting concurrent image categorization via endpoint", {
        photos_count: photos.length,
        obd2_codes_count: obd2_codes.length,
        title_images_count: title_images.length,
        total_images: totalImages,
        inspection_type: inspectionData.type,
      });
      
      try {
        await categorizeImagesConcurrently(
          photos,
          inspectionId,
          obd2_codes,
          title_images,
          inspectionData.type,
          ctx.userId || undefined,
          ctx
        );
        ctx.info("Concurrent image categorization completed successfully");
      } catch (error) {
        ctx.warn("Image categorization failed, continuing with analysis", {
          error: (error as Error).message,
        });
      }
    }

    // Trigger function-call with background processing enabled
    ctx.info("Triggering function-call service for background Dify workflow execution");
    
    try {
      const functionCallResponse = await fetch(`${SUPABASE_CONFIG.url}/functions/v1/function-call`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_CONFIG.serviceKey}`,
          "X-Background-Processing": "true", // Signal to function-call to run in background
        },
        body: JSON.stringify({
          function_name: "car_inspection_workflow",
          response_mode: "streaming",
          inspection_id: inspectionId,
          user_id: ctx.userId,
          query: "Run car inspection analysis workflow",
          background_mode: true, // Flag to indicate background processing
        }),
      });

      if (!functionCallResponse.ok) {
        const errorText = await functionCallResponse.text();
        ctx.error("Function-call service request failed", {
          status: functionCallResponse.status,
          status_text: functionCallResponse.statusText,
          error_text: errorText,
        });
        await Database.updateInspectionStatus(inspectionId, "failed");
        return;
      }

      // For background mode, function-call should return immediately with acknowledgment
      const responseData = await functionCallResponse.json();
      ctx.info("Successfully triggered Dify workflow in background", {
        response: responseData,
      });

    } catch (error) {
      ctx.error("Error triggering function-call service", {
        error: (error as Error).message,
      });
      await Database.updateInspectionStatus(inspectionId, "failed");
    }

    return;
  } catch (error) {
    ctx.error("Background analysis failed", {
      error: (error as Error).message,
    });
    await Database.updateInspectionStatus(inspectionId, "failed");
  }
}

// Helper that chains scrape → analysis
export async function runScrapeThenAnalysis(
  inspection: Inspection,
  ctx: RequestContext
): Promise<void> {
  try {
    ctx.info("Starting scrape for inspection", {
      inspection_id: inspection.id,
    });

    const scrapeRes = await fetch(`${APP_BASE_URL}/api/scrape-vehicle-images`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: inspection.url,
        upload: true,
        bucket: "inspection-photos",
        inspectionId: inspection.id,
      }),
    });

    if (!scrapeRes.ok) {
      throw new Error(`Scrape failed: ${scrapeRes.statusText}`);
    }

    ctx.info("Scrape succeeded, starting analysis", {
      inspection_id: inspection.id,
    });
    await runAnalysisInBackground(inspection.id, ctx);
  } catch (err) {
    ctx.error("Error in scrape→analysis pipeline", {
      inspection_id: inspection.id,
      error: (err as Error).message,
    });
    // Optionally mark inspection as failed
    await Database.updateInspectionStatus(inspection.id, "failed");
  }
}
