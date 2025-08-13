import { openai, supabase } from "./config.ts";
import type { ImageCategorizationResult, UploadResult } from "./schemas.ts";

export class ImageProcessor {
  private userAgents: string[];

  constructor() {
    this.userAgents = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ];
  }

  async processImages(
    imageUrls: string[],
    lotId: string,
    inspectionId: string,
    bucketName = "inspection-photos"
  ): Promise<UploadResult[]> {
    const results: UploadResult[] = [];
    const batchSize = 3;

    console.log(`🚀 Starting processing of ${imageUrls.length} images...`);

    for (let i = 0; i < imageUrls.length; i += batchSize) {
      const batch = imageUrls.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(imageUrls.length / batchSize);

      console.log(`📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} images)...`);

      for (let j = 0; j < batch.length; j++) {
        const url = batch[j];
        const globalIndex = i + j + 1;

        try {
          console.log(`[${globalIndex}/${imageUrls.length}] 📥 Processing: ${url.split("/").pop()}`);

          console.log(`[${globalIndex}/${imageUrls.length}] 📥 Downloading: ${url.split("/").pop()}`);
          const imageBuffer = await this.downloadImageWithRetry(url, 3);

          console.log(`[${globalIndex}/${imageUrls.length}] 🤖 Categorizing with AI...`);
          const categorization = await this.categorizeImage(imageBuffer);

          console.log(
            `[${globalIndex}/${imageUrls.length}] 🏷️ Categorized as: ${categorization.category} (${(categorization.confidence * 100).toFixed(1)}% confidence)`
          );

          const filename = this.generateCategorizedFilename(url, lotId, categorization.category);

          console.log(`[${globalIndex}/${imageUrls.length}] 📤 Uploading as: ${filename}`);

          const uploadResult = await this.uploadToSupabase(imageBuffer, filename, inspectionId, bucketName);

          if (uploadResult.success && uploadResult.url) {
            const dbResult = await this.saveToDatabase(
              inspectionId,
              categorization.category,
              uploadResult.url,
              imageBuffer.length
            );

            if (dbResult.success) {
              results.push({
                success: true,
                originalUrl: url,
                supabaseUrl: uploadResult.url,
                filename: filename,
                category: categorization.category,
              });
            } else {
              results.push({
                success: false,
                originalUrl: url,
                error: `Database save failed: ${dbResult.error}`,
                category: categorization.category,
              });
            }
          } else {
            results.push({
              success: false,
              originalUrl: url,
              error: uploadResult.error,
              category: categorization.category,
            });
          }

          if (j < batch.length - 1) {
            await this.delay(1500, 2500);
          }
        } catch (error) {
          console.error(`[${globalIndex}/${imageUrls.length}] ❌ Processing failed: ${(error as Error).message}`);
          results.push({
            success: false,
            originalUrl: url,
            error: (error as Error).message,
          });
        }
      }

      if (i + batchSize < imageUrls.length) {
        console.log(`⏳ Batch ${batchNumber} completed. Waiting before next batch...`);
        await this.delay(3000, 5000);
      }
    }

    this.logProcessingSummary(results);
    return results;
  }

  private async downloadImageWithRetry(url: string, maxRetries = 3): Promise<Uint8Array> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.downloadImage(url);
      } catch (error) {
        if (attempt === maxRetries) {
          throw error;
        }
        console.log(`Download attempt ${attempt} failed for ${url}, retrying...`);
        await this.delay(1000, 2000);
      }
    }
    throw new Error("Max retries exceeded");
  }

  private async downloadImage(url: string): Promise<Uint8Array> {
    const response = await fetch(url, {
      headers: {
        "User-Agent": this.userAgents[Math.floor(Math.random() * this.userAgents.length)],
        "Referer": this.getRefererForUrl(url),
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }

  private getRefererForUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();

      // Map hostnames to their appropriate referers
      if (hostname.includes("craigslist")) {
        return "https://craigslist.org/";
      } else if (hostname.includes("copart")) {
        return "https://www.copart.com/";
      } else if (hostname.includes("abetter")) {
        return "https://abetter.bid/";
      } else if (hostname.includes("autobidmaster")) {
        return "https://autobidmaster.com/";
      } else if (hostname.includes("capital-auto-auction")) {
        return "https://www.capital-auto-auction.com/";
      } else if (hostname.includes("salvagebid")) {
        return "https://www.salvagebid.com/";
      } else {
        // Default referer based on the image URL's domain
        return `${urlObj.protocol}//${urlObj.hostname}/`;
      }
    } catch (error) {
      // Fallback to a generic referer if URL parsing fails
      return "https://www.google.com/";
    }
  }

  private async categorizeImage(imageBuffer: Uint8Array): Promise<ImageCategorizationResult> {
    try {
      // Convert image buffer to base64 efficiently to avoid stack overflow
      const base64Image = this.arrayBufferToBase64(imageBuffer);

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Analyze this vehicle image and categorize it into one of these specific categories:

**exterior**: Outside views of the vehicle including body panels, doors, bumpers, fenders, paint condition, wheels, tires, headlights, taillights, mirrors, overall vehicle exterior shots

**interior**: Inside cabin views including seats, upholstery, fabric, leather condition, floor mats, carpeting, interior trim, door panels, cabin space, passenger areas

**dashboard**: Dashboard and control area including instrument cluster, gauges, speedometer, steering wheel and controls, center console, radio, climate controls, dashboard condition and electronics, driver's control interface

**engine**: Engine bay and mechanical components including engine block, motor components, belts, hoses, fluid reservoirs, battery, air filter, engine bay condition, mechanical parts under the hood

**undercarriage**: Underneath vehicle views including chassis, frame condition, suspension components, exhaust system, underside structural elements

Respond with a JSON object containing:
- category: one of the categories above
- confidence: a number between 0.0 and 1.0
- reasoning: brief explanation of why this category was chosen

Be precise and choose the most specific category that matches the primary focus of the image.`
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`
                }
              }
            ]
          }
        ],
        max_tokens: 300,
        temperature: 0.1
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("No response from OpenAI");
      }

      // Extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const categorization = JSON.parse(jsonMatch[0]) as ImageCategorizationResult;

      if (!categorization.category || !categorization.confidence || !categorization.reasoning) {
        throw new Error("Invalid structured response from AI");
      }

      categorization.confidence = Math.max(0, Math.min(1, categorization.confidence));

      return categorization;
    } catch (error) {
      console.error("Error categorizing image with AI:", error);
      return {
        category: "exterior",
        confidence: 0.1,
        reasoning: "Failed to categorize with AI, defaulted to exterior",
      };
    }
  }

  private generateCategorizedFilename(originalUrl: string, lotId: string, category: string): string {
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);
    return `${category}_${timestamp}_${randomId}.jpg`;
  }

  private async uploadToSupabase(
    imageBuffer: Uint8Array,
    filename: string,
    inspectionId: string,
    bucketName: string
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    try {
      const uploadPath = `${inspectionId}/${filename}`;

      const { data, error } = await supabase.storage.from(bucketName).upload(uploadPath, imageBuffer, {
        contentType: "image/jpeg",
        cacheControl: "3600",
        upsert: false,
      });

      if (error) {
        console.error(`Supabase upload error for ${filename}:`, error);
        return { success: false, error: error.message };
      }

      const { data: urlData } = supabase.storage.from(bucketName).getPublicUrl(uploadPath);

      return { success: true, url: urlData.publicUrl };
    } catch (error) {
      console.error(`Unexpected error uploading ${filename}:`, error);
      return { success: false, error: (error as Error).message };
    }
  }

  private async saveToDatabase(
    inspectionId: string,
    category: string,
    publicUrl: string,
    fileSize: number
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error: insertError } = await supabase.from("photos").insert({
        inspection_id: inspectionId,
        category,
        path: publicUrl,
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

  private arrayBufferToBase64(buffer: Uint8Array): string {
    // Convert Uint8Array to base64 efficiently without causing stack overflow
    let binary = '';
    const chunkSize = 8192; // Process in chunks to avoid stack overflow
    
    for (let i = 0; i < buffer.length; i += chunkSize) {
      const chunk = buffer.slice(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    
    return btoa(binary);
  }

  private async delay(min: number, max: number): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  private logProcessingSummary(results: UploadResult[]): void {
    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    const categoryStats = results
      .filter((r) => r.success && r.category)
      .reduce((acc: any, r) => {
        acc[r.category!] = (acc[r.category!] || 0) + 1;
        return acc;
      }, {});

    console.log("\n📊 Processing Summary:");
    console.log(`✅ Successful uploads: ${successCount}`);
    console.log(`❌ Failed uploads: ${failureCount}`);
    console.log(`📁 Total processed: ${results.length}`);
    console.log(`🏷️ Category breakdown:`, categoryStats);
    console.log(`💾 Database records created: ${successCount}`);
  }
}
