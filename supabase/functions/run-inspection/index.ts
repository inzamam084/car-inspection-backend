import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { OpenAI } from "https://esm.sh/openai@4.87.3";
// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: Deno.env.get("OPENAI_API_KEY")
});
// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);
// HEIC conversion function
async function convertHeicToJpeg(inspectionId, filePath) {
  try {
    // Check if file is HEIC format
    const fileName = filePath.split('/').pop() || '';
    const fileExtension = fileName.split('.').pop()?.toLowerCase();
    if (fileExtension !== 'heic') {
      console.log(`File ${fileName} is not HEIC format, skipping conversion`);
      return null;
    }
    console.log(`Converting HEIC file: ${fileName}`);
    // Extract the relative path from the full URL
    const urlParts = filePath.split('/inspection-photos/');
    const relativePath = urlParts.length > 1 ? urlParts[1] : fileName;
    // Download the original HEIC file from Supabase Storage
    const { data: fileData, error: downloadError } = await supabase.storage.from('inspection-photos').download(relativePath);
    if (downloadError || !fileData) {
      console.error(`Error downloading HEIC file ${filePath}:`, downloadError);
      return null;
    }
    // Convert ArrayBuffer to Uint8Array for processing
    const heicBuffer = new Uint8Array(await fileData.arrayBuffer());
    // Generate converted filename
    const baseName = fileName.replace(/\.heic$/i, '');
    const convertedFileName = `${baseName}_converted.jpg`;
    const convertedRelativePath = relativePath.replace(fileName, convertedFileName);
    // Use Cloudinary's auto-format feature
    const CLOUDINARY_CLOUD_NAME = "dz0o8yk5i";
    const formData = new FormData();
    formData.append('file', new Blob([
      heicBuffer
    ], {
      type: 'image/heic'
    }));
    formData.append('upload_preset', 'heic-to-jpeg-conversion'); // Configure in Cloudinary
    const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
      method: 'POST',
      body: formData
    });
    if (!response.ok) {
      console.error('Cloudinary conversion failed', response);
      return null;
    }
    const result = await response.json();
    console.log("result.secure_url: ", result.secure_url);
    // Download the converted image from Cloudinary
    const convertedResponse = await fetch(result.secure_url);
    const jpegBuffer = new Uint8Array(await convertedResponse.arrayBuffer());
    // Upload the converted file to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage.from('inspection-photos').upload(convertedRelativePath, jpegBuffer, {
      contentType: 'image/jpeg',
      upsert: true
    });
    if (uploadError) {
      console.error(`Error uploading converted file ${convertedRelativePath}:`, uploadError);
      return null;
    }
    // Generate the full URL for the converted file
    const { data: urlData } = supabase.storage.from('inspection-photos').getPublicUrl(convertedRelativePath);
    const convertedUrl = urlData.publicUrl;
    console.log(`Successfully converted and uploaded: ${convertedUrl}`);
    return convertedUrl;
  } catch (error) {
    console.error(`Error converting HEIC file ${filePath}:`, error);
    return null;
  }
}
// Base URL for the application
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") || "https://ourfixmate.vercel.app/";
// Category priority for chunking
const CATEGORY_PRIORITY = [
  'exterior',
  'interior',
  'dashboard',
  'paint',
  'rust',
  'engine',
  'undercarriage',
  'obd',
  'title',
  'records'
];
// Maximum chunk size in bytes (20MB)
const MAX_CHUNK_SIZE = parseInt(Deno.env.get("MAX_CHUNK_SIZE") ?? "", 10) || 20 * 1024 * 1024;
// Helper function to create category-based chunks within size limit
async function createCategoryBasedChunks(photos, obd2_codes, titleImages, maxSize, inspectionId) {
  const chunks = [];
  let currentChunk = [];
  let currentSize = 0;
  // Combine all images with proper categorization
  const allImages = [];
  // Add photos
  for (const photo of photos){
    let imagePath = photo.converted_path || photo.path;
    // Check if photo is HEIC format and needs conversion
    if (!photo.converted_path && photo.path.toLowerCase().endsWith('.heic')) {
      console.log(`Converting HEIC photo for chunking: ${photo.path}`);
      const convertedPath = await convertHeicToJpeg(inspectionId, photo.path);
      if (convertedPath) {
        // Update database with converted path
        await supabase.from('photos').update({
          converted_path: convertedPath
        }).eq('id', photo.id);
        imagePath = convertedPath;
        photo.converted_path = convertedPath; // Update local object
      }
    }
    allImages.push({
      id: photo.id,
      path: imagePath,
      category: photo.category,
      storage: parseInt(photo.storage) || 0,
      type: 'photo'
    });
  }
  // Add OBD2 images (only those with screenshot_path)
  for (const obd2 of obd2_codes){
    if (obd2.screenshot_path) {
      let imagePath = obd2.converted_path || obd2.screenshot_path;
      // Check if OBD2 screenshot is HEIC format and needs conversion
      if (!obd2.converted_path && obd2.screenshot_path.toLowerCase().endsWith('.heic')) {
        console.log(`Converting HEIC OBD2 screenshot for chunking: ${obd2.screenshot_path}`);
        const convertedPath = await convertHeicToJpeg(inspectionId, obd2.screenshot_path);
        if (convertedPath) {
          // Update database with converted path
          await supabase.from('obd2_codes').update({
            converted_path: convertedPath
          }).eq('id', obd2.id);
          imagePath = convertedPath;
          obd2.converted_path = convertedPath; // Update local object
        }
      }
      allImages.push({
        id: obd2.id,
        path: imagePath,
        category: 'obd',
        storage: parseInt(obd2.storage) || 0,
        type: 'obd2_image',
        code: obd2.code,
        description: obd2.description
      });
    }
  }
  // Add title images
  for (const titleImg of titleImages){
    if (titleImg.path) {
      let imagePath = titleImg.converted_path || titleImg.path;
      // Check if title image is HEIC format and needs conversion
      if (!titleImg.converted_path && titleImg.path.toLowerCase().endsWith('.heic')) {
        console.log(`Converting HEIC title image for chunking: ${titleImg.path}`);
        const convertedPath = await convertHeicToJpeg(inspectionId, titleImg.path);
        if (convertedPath) {
          // Update database with converted path
          await supabase.from('title_images').update({
            converted_path: convertedPath
          }).eq('id', titleImg.id);
          imagePath = convertedPath;
          titleImg.converted_path = convertedPath; // Update local object
        }
      }
      allImages.push({
        id: titleImg.id,
        path: imagePath,
        category: 'title',
        storage: parseInt(titleImg.storage) || 0,
        type: 'title_image'
      });
    }
  }
  // Sort by category priority
  const sortedImages = allImages.sort((a, b)=>{
    const aIndex = CATEGORY_PRIORITY.indexOf(a.category) !== -1 ? CATEGORY_PRIORITY.indexOf(a.category) : CATEGORY_PRIORITY.length;
    const bIndex = CATEGORY_PRIORITY.indexOf(b.category) !== -1 ? CATEGORY_PRIORITY.indexOf(b.category) : CATEGORY_PRIORITY.length;
    return aIndex - bIndex;
  });
  for (const image of sortedImages){
    const imageSize = parseInt(image.storage) || 0;
    if (currentSize + imageSize > maxSize && currentChunk.length > 0) {
      chunks.push({
        images: currentChunk,
        totalSize: currentSize,
        chunkIndex: chunks.length
      });
      currentChunk = [
        image
      ];
      currentSize = imageSize;
    } else {
      currentChunk.push(image);
      currentSize += imageSize;
    }
  }
  if (currentChunk.length > 0) {
    chunks.push({
      images: currentChunk,
      totalSize: currentSize,
      chunkIndex: chunks.length
    });
  }
  return chunks;
}
// Background analysis function
async function runAnalysisInBackground(inspectionId) {
  try {
    console.log(`Starting background analysis for inspection ${inspectionId}`);
    // Update status to processing
    await supabase.from("inspections").update({
      status: "processing"
    }).eq("id", inspectionId);
    // Fetch inspection details
    const { data: inspection, error: inspectionError } = await supabase.from("inspections").select("id, vin, email, mileage, zip").eq("id", inspectionId).single();
    if (inspectionError) {
      console.error("Error fetching inspection:", inspectionError);
      await supabase.from("inspections").update({
        status: "failed"
      }).eq("id", inspectionId);
      return;
    }
    // Update status to analyzing
    await supabase.from("inspections").update({
      status: "analyzing"
    }).eq("id", inspectionId);
    // Fetch all photos for this inspection with storage info
    const { data: photos, error: photosError } = await supabase.from("photos").select("id, category, path, storage").eq("inspection_id", inspectionId);
    if (photosError || !photos || photos.length === 0) {
      console.error("Error fetching photos:", photosError);
      await supabase.from("inspections").update({
        status: "failed"
      }).eq("id", inspectionId);
      return;
    }
    // Fetch OBD2 codes
    const { data: obd2_codes, error: obd2Error } = await supabase.from("obd2_codes").select("id, code, description, screenshot_path, storage").eq("inspection_id", inspectionId);
    if (obd2Error) {
      console.error("Error fetching OBD2 Codes:", obd2Error);
      await supabase.from("inspections").update({
        status: "failed"
      }).eq("id", inspectionId);
      return;
    }
    // Fetch title images
    const { data: titleImages, error: titleImageError } = await supabase.from("title_images").select("id, path, storage").eq("inspection_id", inspectionId);
    if (titleImageError) {
      console.error("Error fetching Title Images:", titleImageError);
      await supabase.from("inspections").update({
        status: "failed"
      }).eq("id", inspectionId);
      return;
    }
    // Create data block for the master prompt
    const dataBlock = {
      vin: inspection.vin,
      mileage: inspection?.mileage || null,
      zip: inspection?.zip || null,
      vinHistory: null,
      marketPriceBands: null
    };
    // Check if images need chunking based on total size
    const photosSize = photos.reduce((sum, photo)=>sum + (parseInt(photo.storage) || 0), 0);
    const obd2ImagesSize = obd2_codes.reduce((sum, obd)=>sum + (parseInt(obd.storage) || 0), 0);
    const titleImagesSize = titleImages.reduce((sum, img)=>sum + (parseInt(img.storage) || 0), 0);
    const totalImageSize = photosSize + obd2ImagesSize + titleImagesSize;
    console.log(`Total image size: ${(totalImageSize / (1024 * 1024)).toFixed(2)} MB`);
    // Use queue-based processing for large inspections
    console.log("Processing inspection using queue-based system");
    // Update status to creating_jobs
    await supabase.from("inspections").update({
      status: "creating_jobs"
    }).eq("id", inspectionId);
    // Create chunks
    const chunks = await createCategoryBasedChunks(photos, obd2_codes, titleImages, MAX_CHUNK_SIZE, inspectionId);
    console.log(`Created ${chunks.length} chunks for queue processing`);
    // Create processing jobs for each chunk
    const jobs = [];
    for(let i = 0; i < chunks.length; i++){
      jobs.push({
        inspection_id: inspectionId,
        job_type: 'chunk_analysis',
        sequence_order: i + 1,
        chunk_index: i + 1,
        total_chunks: chunks.length,
        chunk_data: {
          images: chunks[i].images
        },
        status: 'pending'
      });
    }
    // Add ownership cost forecast, fair market value and expert advice jobs after chunk analysis
    const nextSequence = chunks.length + 1;
    jobs.push({
      inspection_id: inspectionId,
      job_type: 'ownership_cost_forecast',
      sequence_order: nextSequence,
      chunk_index: 1,
      total_chunks: 1,
      chunk_data: {},
      status: 'pending'
    });
    jobs.push({
      inspection_id: inspectionId,
      job_type: 'fair_market_value',
      sequence_order: nextSequence + 1,
      chunk_index: 1,
      total_chunks: 1,
      chunk_data: {},
      status: 'pending'
    });
    jobs.push({
      inspection_id: inspectionId,
      job_type: 'expert_advice',
      sequence_order: nextSequence + 2,
      chunk_index: 1,
      total_chunks: 1,
      chunk_data: {},
      status: 'pending'
    });
    // Insert all jobs into the queue
    const { error: jobsError } = await supabase.from('processing_jobs').insert(jobs);
    if (jobsError) {
      console.error('Error creating processing jobs:', jobsError);
      await supabase.from("inspections").update({
        status: "failed"
      }).eq("id", inspectionId);
      return;
    }
    console.log(`Created ${jobs.length} processing jobs for inspection ${inspectionId}`);
    // Trigger the first chunk processing
    const triggerResponse = await fetch(`${supabaseUrl}/functions/v1/process-next-chunk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`
      },
      body: JSON.stringify({
        inspection_id: inspectionId,
        completed_sequence: 0
      })
    });
    if (!triggerResponse.ok) {
      console.error('Error triggering first chunk processing');
      await supabase.from("inspections").update({
        status: "failed"
      }).eq("id", inspectionId);
      return;
    }
    console.log(`Successfully triggered queue-based processing for inspection ${inspectionId}`);
    return;
  } catch (error) {
    console.error(`Background analysis failed for inspection ${inspectionId}:`, error);
    await supabase.from("inspections").update({
      status: "failed"
    }).eq("id", inspectionId);
  }
}
// 2. New helper that chains scrape → analysis
async function runScrapeThenAnalysis(inspection) {
  try {
    console.log(`Starting scrape for inspection ${inspection.id}`);
    const scrapeRes = await fetch(`${APP_BASE_URL}/api/scrape-copart-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: inspection.url,
        upload: true,
        bucket: 'inspection-photos',
        inspectionId: inspection.id
      })
    });
    if (!scrapeRes.ok) {
      throw new Error(`Scrape failed: ${scrapeRes.statusText}`);
    }
    console.log(`Scrape succeeded for inspection ${inspection.id}, starting analysis`);
    await runAnalysisInBackground(inspection.id);
  } catch (err) {
    console.error(`Error in scrape→analysis for ${inspection.id}:`, err);
    // Optionally mark inspection as failed
    await supabase.from('inspections').update({
      status: 'failed'
    }).eq('id', inspection.id);
  }
}
// Main serve function
serve(async (req)=>{
  try {
    console.log("Request received..");
    console.log("HELLO")
    // Parse the webhook payload
    const payload = await req.json();
    console.log("Received webhook payload:", JSON.stringify(payload));
    const inspectionId = payload.inspection_id;
    console.log(`Processing analysis for inspection ${inspectionId}`);
    // Basic validation - just check if inspection exists
    const { data: inspection, error: inspectionError } = await supabase.from("inspections").select("id, vin, email, type, url").eq("id", inspectionId).single();
    if (inspectionError) {
      console.error("Error fetching inspection:", inspectionError);
      return new Response(JSON.stringify({
        error: "Failed to fetch inspection details"
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    // Decide which pipeline to invoke
    const backgroundTask = inspection.type === 'url' ? ()=>runScrapeThenAnalysis(inspection) : ()=>runAnalysisInBackground(inspection.id);
    // Kick off in background
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      EdgeRuntime.waitUntil(backgroundTask());
    } else {
      backgroundTask().catch((err)=>console.error(err));
    }
    // // Start background analysis using EdgeRuntime.waitUntil
    // // This allows the function to return immediately while analysis continues
    // if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
    //   EdgeRuntime.waitUntil(runAnalysisInBackground(inspectionId));
    // } else {
    //   // Fallback for environments without EdgeRuntime.waitUntil
    //   runAnalysisInBackground(inspectionId).catch((error)=>{
    //     console.error(`Background analysis failed for inspection ${inspectionId}:`, error);
    //   });
    // }
    // Return immediate response
    return new Response(JSON.stringify({
      success: true,
      message: "Analysis started in background",
      inspectionId,
      status: "processing"
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(JSON.stringify({
      error: "Internal server error"
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
});
