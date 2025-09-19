import { supabase } from "./config.ts";
import {
  getRefererForUrl,
  generateCategorizedFilename,
  getRandomDelay,
} from "./image-utils.ts";
import type { UploadResult } from "./schemas.ts";

/**
 * Processing modes available for image processing
 */
export enum ProcessingMode {
  /** Sequential processing with batches and delays (original behavior) */
  SEQUENTIAL = "sequential",
  /** Parallel processing with controlled concurrency */
  PARALLEL = "parallel",
  /** Streaming processing that pipes images directly without memory buffering */
  STREAMING = "streaming",
  /** Hybrid approach: tries streaming first, falls back to parallel if needed */
  HYBRID = "hybrid",
}

/**
 * Enhanced ImageProcessor class that supports multiple processing modes:
 * - Sequential: Original batch processing with delays
 * - Parallel: Concurrent processing with controlled limits
 * - Streaming: Direct streaming from source to destination without memory buffering
 * - Hybrid: Intelligent fallback from streaming to parallel processing
 *
 * Features:
 * - Automatic retry logic with exponential backoff
 * - Circuit breaker pattern for external API failures
 * - Comprehensive error handling and logging
 * - Memory-efficient streaming for large images
 * - Configurable concurrency limits
 */
export class ImageProcessor {
  // Configuration constants
  private readonly MAX_CONCURRENT_OPERATIONS = 5;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAYS = [1000, 3000, 5000]; // Progressive backoff in ms
  private readonly STREAM_TIMEOUT = 45000; // 45 seconds for streaming operations
  private readonly CIRCUIT_BREAKER_THRESHOLD = 5; // Failures before opening circuit
  private readonly CIRCUIT_BREAKER_TIMEOUT = 60000; // 60 seconds before retry

  // Instance state
  private userAgents: string[];
  private activeOperations = 0;
  private operationQueue: Array<() => Promise<void>> = [];

  // Circuit breaker state
  private failures = 0;
  private lastFailureTime = 0;
  private circuitBreakerOpen = false;

  /**
   * Initialize the ImageProcessor with default configuration
   */
  constructor() {
    this.userAgents = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ];
  }

  /**
   * Main entry point for processing images with configurable processing mode
   *
   * @param imageUrls - Array of image URLs to process
   * @param lotId - Unique identifier for the lot/batch
   * @param inspectionId - Inspection ID for database storage
   * @param bucketName - Supabase storage bucket name
   * @param mode - Processing mode to use (default: HYBRID)
   * @returns Promise resolving to array of upload results
   */
  async processImages(
    imageUrls: string[],
    lotId: string,
    inspectionId: string,
    bucketName = "inspection-photos",
    mode: ProcessingMode = ProcessingMode.HYBRID
  ): Promise<UploadResult[]> {
    const startTime = Date.now();
    console.log(
      `🚀 Starting ${mode} processing of ${imageUrls.length} images...`
    );

    if (mode !== ProcessingMode.SEQUENTIAL) {
      console.log(
        `📊 Max concurrent operations: ${this.MAX_CONCURRENT_OPERATIONS}`
      );
    }

    try {
      let results: UploadResult[];

      switch (mode) {
        case ProcessingMode.SEQUENTIAL:
          results = await this.processSequential(
            imageUrls,
            lotId,
            inspectionId,
            bucketName
          );
          break;
        case ProcessingMode.PARALLEL:
          results = await this.processParallel(
            imageUrls,
            lotId,
            inspectionId,
            bucketName
          );
          break;
        case ProcessingMode.STREAMING:
          results = await this.processStreaming(
            imageUrls,
            lotId,
            inspectionId,
            bucketName
          );
          break;
        case ProcessingMode.HYBRID:
        default:
          results = await this.processHybrid(
            imageUrls,
            lotId,
            inspectionId,
            bucketName
          );
          break;
      }

      const duration = Date.now() - startTime;
      this.logProcessingSummary(results, duration, mode);
      return results;
    } catch (error) {
      console.error(`❌ ${mode} processing failed:`, error);
      throw error;
    }
  }

  /**
   * Sequential processing (original behavior)
   * Processes images in small batches with delays between batches
   */
  private async processSequential(
    imageUrls: string[],
    lotId: string,
    inspectionId: string,
    bucketName: string
  ): Promise<UploadResult[]> {
    const results: UploadResult[] = [];
    const batchSize = 3;

    for (let i = 0; i < imageUrls.length; i += batchSize) {
      const batch = imageUrls.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(imageUrls.length / batchSize);

      console.log(
        `📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} images)...`
      );

      for (let j = 0; j < batch.length; j++) {
        const url = batch[j];
        const globalIndex = i + j + 1;

        const result = await this.processSingleImageBuffered(
          url,
          globalIndex,
          imageUrls.length,
          lotId,
          inspectionId,
          bucketName
        );
        results.push(result);

        if (j < batch.length - 1) {
          await getRandomDelay(1500, 2500);
        }
      }

      if (i + batchSize < imageUrls.length) {
        console.log(
          `⏳ Batch ${batchNumber} completed. Waiting before next batch...`
        );
        await getRandomDelay(3000, 5000);
      }
    }

    return results;
  }

  /**
   * Parallel processing with controlled concurrency
   * Processes multiple images simultaneously with configurable limits
   */
  private async processParallel(
    imageUrls: string[],
    lotId: string,
    inspectionId: string,
    bucketName: string
  ): Promise<UploadResult[]> {
    const promises = imageUrls.map(async (url, index) => {
      return await this.acquireOperationSlot(async () => {
        return await this.processSingleImageBuffered(
          url,
          index + 1,
          imageUrls.length,
          lotId,
          inspectionId,
          bucketName
        );
      });
    });

    const settledResults = await Promise.allSettled(promises);
    return this.processSettledResults(settledResults, imageUrls);
  }

  /**
   * Streaming processing that pipes images directly without memory buffering
   * Most memory-efficient approach for large images
   */
  private async processStreaming(
    imageUrls: string[],
    lotId: string,
    inspectionId: string,
    bucketName: string
  ): Promise<UploadResult[]> {
    const promises = imageUrls.map(async (url, index) => {
      return await this.acquireOperationSlot(async () => {
        return await this.processSingleImageStreaming(
          url,
          index + 1,
          imageUrls.length,
          lotId,
          inspectionId,
          bucketName
        );
      });
    });

    const settledResults = await Promise.allSettled(promises);
    return this.processSettledResults(settledResults, imageUrls);
  }

  /**
   * Hybrid processing: tries streaming first, falls back to parallel buffering
   * Provides best balance of performance and reliability
   */
  private async processHybrid(
    imageUrls: string[],
    lotId: string,
    inspectionId: string,
    bucketName: string
  ): Promise<UploadResult[]> {
    console.log(
      `🔄 Starting hybrid processing (streaming with parallel fallback)...`
    );

    // First pass: Try streaming
    const streamingResults = await this.processStreaming(
      imageUrls,
      lotId,
      inspectionId,
      bucketName
    );

    // Identify failed streams for retry
    const failedUrls: { url: string; index: number }[] = [];
    const results: UploadResult[] = [];

    streamingResults.forEach((result, index) => {
      if (result.success) {
        results.push(result);
      } else {
        failedUrls.push({ url: imageUrls[index], index });
        console.log(
          `🔄 Will retry ${imageUrls[index]
            .split("/")
            .pop()} with buffered approach`
        );
      }
    });

    // Second pass: Retry failed streams with parallel buffering
    if (failedUrls.length > 0) {
      console.log(
        `📦 Retrying ${failedUrls.length} failed streams with parallel buffering...`
      );

      const retryPromises = failedUrls.map(async ({ url, index }) => {
        return await this.acquireOperationSlot(async () => {
          return await this.processSingleImageBuffered(
            url,
            index + 1,
            imageUrls.length,
            lotId,
            inspectionId,
            bucketName
          );
        });
      });

      const retryResults = await Promise.allSettled(retryPromises);

      retryResults.forEach((result, retryIndex) => {
        if (result.status === "fulfilled") {
          results.push(result.value);
        } else {
          const originalUrl = failedUrls[retryIndex].url;
          results.push({
            success: false,
            originalUrl,
            error: `Both streaming and buffered approaches failed: ${result.reason?.message}`,
            category: "uncategorized",
          });
        }
      });
    }

    return results;
  }

  /**
   * Process a single image using buffered approach (loads image into memory)
   * Used for parallel and sequential processing modes
   */
  private async processSingleImageBuffered(
    url: string,
    globalIndex: number,
    totalImages: number,
    lotId: string,
    inspectionId: string,
    bucketName: string
  ): Promise<UploadResult> {
    return await this.processImageWithRetry(
      url,
      globalIndex,
      totalImages,
      lotId,
      inspectionId,
      bucketName,
      "buffered"
    );
  }

  /**
   * Process a single image using streaming approach (no memory buffering)
   * Used for streaming and hybrid processing modes
   */
  private async processSingleImageStreaming(
    url: string,
    globalIndex: number,
    totalImages: number,
    lotId: string,
    inspectionId: string,
    bucketName: string
  ): Promise<UploadResult> {
    return await this.processImageWithRetry(
      url,
      globalIndex,
      totalImages,
      lotId,
      inspectionId,
      bucketName,
      "streaming"
    );
  }

  /**
   * Process image with retry logic and circuit breaker protection
   */
  private async processImageWithRetry(
    url: string,
    globalIndex: number,
    totalImages: number,
    lotId: string,
    inspectionId: string,
    bucketName: string,
    method: "buffered" | "streaming"
  ): Promise<UploadResult> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        // Check circuit breaker before attempting operation
        this.checkCircuitBreaker();

        if (method === "streaming") {
          return await this.streamImageDirectly(
            url,
            globalIndex,
            totalImages,
            lotId,
            inspectionId,
            bucketName
          );
        } else {
          return await this.processImageBuffered(
            url,
            globalIndex,
            totalImages,
            lotId,
            inspectionId,
            bucketName
          );
        }
      } catch (error) {
        lastError = error as Error;
        this.recordFailure();

        console.warn(
          `[${globalIndex}/${totalImages}] ${method} attempt ${
            attempt + 1
          } failed for ${url.split("/").pop()}: ${error.message}`
        );

        if (attempt < this.MAX_RETRIES - 1) {
          await this.delay(this.RETRY_DELAYS[attempt]);
        }
      }
    }

    return {
      success: false,
      originalUrl: url,
      error: lastError?.message || `Max ${method} retries exceeded`,
      category: "uncategorized",
    };
  }

  /**
   * Stream image directly from source to Supabase without loading into memory
   * Most memory-efficient approach
   */
  private async streamImageDirectly(
    url: string,
    globalIndex: number,
    totalImages: number,
    lotId: string,
    inspectionId: string,
    bucketName: string
  ): Promise<UploadResult> {
    console.log(
      `[${globalIndex}/${totalImages}] 🌊 Streaming: ${url.split("/").pop()}`
    );

    const filename = generateCategorizedFilename(url, lotId, "uncategorized");
    const uploadPath = `${inspectionId}/${filename}`;

    // Set up timeout for streaming operation
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      console.warn(
        `[${globalIndex}/${totalImages}] ⏰ Stream timeout for ${filename}`
      );
    }, this.STREAM_TIMEOUT);

    try {
      // Fetch with streaming-optimized headers
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            this.userAgents[Math.floor(Math.random() * this.userAgents.length)],
          Referer: getRefererForUrl(url),
          Accept:
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          "Cache-Control": "no-cache",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("No response body available for streaming");
      }

      const contentType = response.headers.get("content-type") || "image/jpeg";
      const contentLength = response.headers.get("content-length");

      // Stream directly to Supabase - this is the key memory optimization!
      const { data, error } = await supabase.storage
        .from(bucketName)
        .upload(uploadPath, response.body, {
          contentType: contentType,
          cacheControl: "3600",
          upsert: false,
        });

      if (error) {
        throw new Error(`Supabase streaming upload failed: ${error.message}`);
      }

      const { data: urlData } = supabase.storage
        .from(bucketName)
        .getPublicUrl(uploadPath);

      // Save metadata to database
      const estimatedSize = contentLength ? parseInt(contentLength) : 0;
      const dbResult = await this.saveToDatabase(
        inspectionId,
        "uncategorized",
        urlData.publicUrl,
        estimatedSize,
        url // Pass original image URL
      );

      if (!dbResult.success) {
        throw new Error(`Database save failed: ${dbResult.error}`);
      }

      this.recordSuccess();
      console.log(
        `[${globalIndex}/${totalImages}] ✅ Stream completed: ${filename}`
      );

      return {
        success: true,
        originalUrl: url,
        supabaseUrl: urlData.publicUrl,
        filename: filename,
        category: "uncategorized",
      };
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error(`Streaming timeout after ${this.STREAM_TIMEOUT}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Process image using traditional buffered approach (loads into memory)
   */
  private async processImageBuffered(
    url: string,
    globalIndex: number,
    totalImages: number,
    lotId: string,
    inspectionId: string,
    bucketName: string
  ): Promise<UploadResult> {
    console.log(
      `[${globalIndex}/${totalImages}] 📥 Processing: ${url.split("/").pop()}`
    );

    const imageBuffer = await this.downloadImageWithRetry(url, 3);
    const filename = generateCategorizedFilename(url, lotId, "uncategorized");

    console.log(`[${globalIndex}/${totalImages}] 📤 Uploading: ${filename}`);

    const uploadResult = await this.uploadToSupabase(
      imageBuffer,
      filename,
      inspectionId,
      bucketName,
      "image/png"
    );

    if (uploadResult.success && uploadResult.url) {
      const dbResult = await this.saveToDatabase(
        inspectionId,
        "uncategorized",
        uploadResult.url,
        imageBuffer.length,
        url // Pass original image URL
      );

      if (dbResult.success) {
        this.recordSuccess();
        console.log(
          `[${globalIndex}/${totalImages}] ✅ Completed: ${filename}`
        );
        return {
          success: true,
          originalUrl: url,
          supabaseUrl: uploadResult.url,
          filename: filename,
          category: "uncategorized",
        };
      } else {
        throw new Error(`Database save failed: ${dbResult.error}`);
      }
    } else {
      throw new Error(uploadResult.error || "Upload failed");
    }
  }

  /**
   * Download image with retry logic
   */
  private async downloadImageWithRetry(
    url: string,
    maxRetries = 3
  ): Promise<Uint8Array> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.downloadImage(url);
      } catch (error) {
        if (attempt === maxRetries) {
          throw error;
        }
        console.log(
          `Download attempt ${attempt} failed for ${url}, retrying...`
        );
        await getRandomDelay(1000, 2000);
      }
    }
    throw new Error("Max retries exceeded");
  }

  /**
   * Download image into memory buffer
   */
  private async downloadImage(url: string): Promise<Uint8Array> {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          this.userAgents[Math.floor(Math.random() * this.userAgents.length)],
        Referer: getRefererForUrl(url),
        Accept:
          "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }

  /**
   * Upload image buffer to Supabase storage
   */
  private async uploadToSupabase(
    imageBuffer: Uint8Array,
    filename: string,
    inspectionId: string,
    bucketName: string,
    contentType: string = "image/jpeg"
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    try {
      const uploadPath = `${inspectionId}/${filename}`;

      const { data, error } = await supabase.storage
        .from(bucketName)
        .upload(uploadPath, imageBuffer, {
          contentType: contentType,
          cacheControl: "3600",
          upsert: false,
        });

      if (error) {
        console.error(`Supabase upload error for ${filename}:`, error);
        return { success: false, error: error.message };
      }

      const { data: urlData } = supabase.storage
        .from(bucketName)
        .getPublicUrl(uploadPath);

      return { success: true, url: urlData.publicUrl };
    } catch (error) {
      console.error(`Unexpected error uploading ${filename}:`, error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Save image metadata to database
   */
  private async saveToDatabase(
    inspectionId: string,
    category: string,
    publicUrl: string,
    fileSize: number,
    originalImageUrl?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error: insertError } = await supabase.from("photos").insert({
        inspection_id: inspectionId,
        category,
        path: publicUrl,
        image_url: originalImageUrl || null, // Save original URL from extension
        storage: fileSize.toString(),
        created_at: new Date().toISOString(),
      });

      if (insertError) {
        console.error("Database insert error:", insertError);
        return { success: false, error: insertError.message };
      }

      return { success: true };
    } catch (error) {
      console.error("Unexpected error saving to database:", error);
      return { success: false, error: (error as Error).message };
    }
  }

  // === Concurrency Control ===

  /**
   * Acquire an operation slot with concurrency control
   */
  private async acquireOperationSlot<T>(
    operation: () => Promise<T>
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const executeOperation = async () => {
        this.activeOperations++;
        try {
          const result = await operation();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.activeOperations--;
          this.processOperationQueue();
        }
      };

      if (this.activeOperations < this.MAX_CONCURRENT_OPERATIONS) {
        executeOperation();
      } else {
        this.operationQueue.push(executeOperation);
      }
    });
  }

  /**
   * Process queued operations when slots become available
   */
  private processOperationQueue(): void {
    if (
      this.operationQueue.length > 0 &&
      this.activeOperations < this.MAX_CONCURRENT_OPERATIONS
    ) {
      const nextOperation = this.operationQueue.shift();
      if (nextOperation) {
        nextOperation();
      }
    }
  }

  // === Circuit Breaker ===

  /**
   * Check circuit breaker state before operations
   */
  private checkCircuitBreaker(): void {
    if (this.circuitBreakerOpen) {
      if (Date.now() - this.lastFailureTime > this.CIRCUIT_BREAKER_TIMEOUT) {
        this.circuitBreakerOpen = false;
        console.log("🔧 Circuit breaker reset - attempting operations");
      } else {
        throw new Error("Circuit breaker is open - too many failures");
      }
    }
  }

  /**
   * Record successful operation for circuit breaker
   */
  private recordSuccess(): void {
    this.failures = 0;
    this.circuitBreakerOpen = false;
  }

  /**
   * Record failed operation for circuit breaker
   */
  private recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.CIRCUIT_BREAKER_THRESHOLD) {
      this.circuitBreakerOpen = true;
      console.warn(`🚨 Circuit breaker opened after ${this.failures} failures`);
    }
  }

  // === Utility Methods ===

  /**
   * Delay execution for specified milliseconds
   */
  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Process settled promise results into UploadResult array
   */
  private processSettledResults(
    settledResults: PromiseSettledResult<UploadResult>[],
    imageUrls: string[]
  ): UploadResult[] {
    return settledResults.map((result, index) => {
      if (result.status === "fulfilled") {
        return result.value;
      } else {
        console.error(
          `[${index + 1}/${imageUrls.length}] ❌ Processing failed:`,
          result.reason
        );
        return {
          success: false,
          originalUrl: imageUrls[index],
          error: result.reason?.message || "Unknown error",
          category: "uncategorized",
        } as UploadResult;
      }
    });
  }

  /**
   * Log comprehensive processing summary with performance metrics
   */
  private logProcessingSummary(
    results: UploadResult[],
    duration: number,
    mode: ProcessingMode
  ): void {
    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    const categoryStats = results
      .filter((r) => r.success && r.category)
      .reduce((acc: any, r) => {
        acc[r.category!] = (acc[r.category!] || 0) + 1;
        return acc;
      }, {});

    const errorStats = results
      .filter((r) => !r.success && r.error)
      .reduce((acc: any, r) => {
        const errorType = r.error!.includes("timeout")
          ? "timeout"
          : r.error!.includes("HTTP")
          ? "http_error"
          : r.error!.includes("streaming")
          ? "streaming_error"
          : r.error!.includes("Circuit breaker")
          ? "circuit_breaker"
          : "other";
        acc[errorType] = (acc[errorType] || 0) + 1;
        return acc;
      }, {});

    console.log(`\n📊 ${mode.toUpperCase()} Processing Summary:`);
    console.log(`✅ Successful uploads: ${successCount}`);
    console.log(`❌ Failed uploads: ${failureCount}`);
    console.log(`📁 Total processed: ${results.length}`);
    console.log(`⏱️ Total duration: ${Math.round(duration / 1000)}s`);
    console.log(
      `🚀 Average per image: ${Math.round(duration / results.length)}ms`
    );
    console.log(`🏷️ Category breakdown:`, categoryStats);
    console.log(`💾 Database records created: ${successCount}`);
    console.log(
      `🔧 Circuit breaker: ${this.circuitBreakerOpen ? "OPEN" : "CLOSED"}`
    );
    console.log(`📊 Active operations: ${this.activeOperations}`);

    if (failureCount > 0) {
      console.log(`⚠️ Error breakdown:`, errorStats);
    }

    // Show memory savings for streaming modes
    if (mode === ProcessingMode.STREAMING || mode === ProcessingMode.HYBRID) {
      const estimatedMemorySaved = Math.round((successCount * 2) / 1024); // Rough estimate
      console.log(
        `💾 Estimated memory saved: ~${estimatedMemorySaved}MB vs buffered approach`
      );
    }
  }

  /**
   * Get current processor statistics and configuration
   */
  getProcessorStats(): {
    activeOperations: number;
    queuedOperations: number;
    maxConcurrentOperations: number;
    circuitBreakerOpen: boolean;
    failures: number;
    configuration: {
      maxRetries: number;
      streamTimeout: number;
      circuitBreakerThreshold: number;
      circuitBreakerTimeout: number;
    };
  } {
    return {
      activeOperations: this.activeOperations,
      queuedOperations: this.operationQueue.length,
      maxConcurrentOperations: this.MAX_CONCURRENT_OPERATIONS,
      circuitBreakerOpen: this.circuitBreakerOpen,
      failures: this.failures,
      configuration: {
        maxRetries: this.MAX_RETRIES,
        streamTimeout: this.STREAM_TIMEOUT,
        circuitBreakerThreshold: this.CIRCUIT_BREAKER_THRESHOLD,
        circuitBreakerTimeout: this.CIRCUIT_BREAKER_TIMEOUT,
      },
    };
  }

  /**
   * Reset circuit breaker manually (for administrative purposes)
   */
  resetCircuitBreaker(): void {
    this.failures = 0;
    this.circuitBreakerOpen = false;
    this.lastFailureTime = 0;
    console.log("🔧 Circuit breaker manually reset");
  }
}
