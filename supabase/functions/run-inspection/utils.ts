import { supabase, CLOUDINARY_CLOUD_NAME, CATEGORY_PRIORITY, MAX_CHUNK_SIZE } from "./config.ts";
import type { Photo, OBD2Code, TitleImage, ChunkImage, ImageChunk } from "./schemas.ts";

// HEIC conversion function
export async function convertHeicToJpeg(inspectionId: string, filePath: string): Promise<string | null> {
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
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('inspection-photos')
      .download(relativePath);

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
    const formData = new FormData();
    formData.append('file', new Blob([heicBuffer], { type: 'image/heic' }));
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
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('inspection-photos')
      .upload(convertedRelativePath, jpegBuffer, {
        contentType: 'image/jpeg',
        upsert: true
      });

    if (uploadError) {
      console.error(`Error uploading converted file ${convertedRelativePath}:`, uploadError);
      return null;
    }

    // Generate the full URL for the converted file
    const { data: urlData } = supabase.storage
      .from('inspection-photos')
      .getPublicUrl(convertedRelativePath);
    
    const convertedUrl = urlData.publicUrl;
    console.log(`Successfully converted and uploaded: ${convertedUrl}`);
    
    return convertedUrl;
  } catch (error) {
    console.error(`Error converting HEIC file ${filePath}:`, error);
    return null;
  }
}

// Helper function to create category-based chunks within size limit
export async function createCategoryBasedChunks(
  photos: Photo[], 
  obd2_codes: OBD2Code[], 
  titleImages: TitleImage[], 
  maxSize: number, 
  inspectionId: string
): Promise<ImageChunk[]> {
  const chunks: ImageChunk[] = [];
  let currentChunk: ChunkImage[] = [];
  let currentSize = 0;

  // Combine all images with proper categorization
  const allImages: ChunkImage[] = [];

  // Add photos
  for (const photo of photos) {
    let imagePath = photo.converted_path || photo.path;
    
    // Check if photo is HEIC format and needs conversion
    if (!photo.converted_path && photo.path.toLowerCase().endsWith('.heic')) {
      console.log(`Converting HEIC photo for chunking: ${photo.path}`);
      const convertedPath = await convertHeicToJpeg(inspectionId, photo.path);
      if (convertedPath) {
        // Update database with converted path
        await supabase
          .from('photos')
          .update({ converted_path: convertedPath })
          .eq('id', photo.id);
        
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
  for (const obd2 of obd2_codes) {
    if (obd2.screenshot_path) {
      let imagePath = obd2.converted_path || obd2.screenshot_path;
      
      // Check if OBD2 screenshot is HEIC format and needs conversion
      if (!obd2.converted_path && obd2.screenshot_path.toLowerCase().endsWith('.heic')) {
        console.log(`Converting HEIC OBD2 screenshot for chunking: ${obd2.screenshot_path}`);
        const convertedPath = await convertHeicToJpeg(inspectionId, obd2.screenshot_path);
        if (convertedPath) {
          // Update database with converted path
          await supabase
            .from('obd2_codes')
            .update({ converted_path: convertedPath })
            .eq('id', obd2.id);
          
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
  for (const titleImg of titleImages) {
    if (titleImg.path) {
      let imagePath = titleImg.converted_path || titleImg.path;
      
      // Check if title image is HEIC format and needs conversion
      if (!titleImg.converted_path && titleImg.path.toLowerCase().endsWith('.heic')) {
        console.log(`Converting HEIC title image for chunking: ${titleImg.path}`);
        const convertedPath = await convertHeicToJpeg(inspectionId, titleImg.path);
        if (convertedPath) {
          // Update database with converted path
          await supabase
            .from('title_images')
            .update({ converted_path: convertedPath })
            .eq('id', titleImg.id);
          
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
  const sortedImages = allImages.sort((a, b) => {
    const aIndex = CATEGORY_PRIORITY.indexOf(a.category) !== -1 
      ? CATEGORY_PRIORITY.indexOf(a.category) 
      : CATEGORY_PRIORITY.length;
    const bIndex = CATEGORY_PRIORITY.indexOf(b.category) !== -1 
      ? CATEGORY_PRIORITY.indexOf(b.category) 
      : CATEGORY_PRIORITY.length;
    return aIndex - bIndex;
  });

  for (const image of sortedImages) {
    const imageSize = parseInt(image.storage.toString()) || 0;
    
    if (currentSize + imageSize > maxSize && currentChunk.length > 0) {
      chunks.push({
        images: currentChunk,
        totalSize: currentSize,
        chunkIndex: chunks.length
      });
      currentChunk = [image];
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
