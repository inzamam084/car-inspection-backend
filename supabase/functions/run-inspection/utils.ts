import { CATEGORY_PRIORITY } from "./config.ts";
import type {
  ChunkImage,
  ImageChunk,
  OBD2Code,
  Photo,
  TitleImage,
} from "./schemas.ts";

// Helper function to create category-based chunks within size limit
export function createCategoryBasedChunks(
  photos: Photo[],
  obd2_codes: OBD2Code[],
  titleImages: TitleImage[],
  maxSize: number,
): ImageChunk[] {
  const chunks: ImageChunk[] = [];
  let currentChunk: ChunkImage[] = [];
  let currentSize = 0;

  // Combine all images with proper categorization
  const allImages: ChunkImage[] = [];

  // Add photos
  for (const photo of photos) {
    allImages.push({
      id: photo.id,
      path: photo.converted_path || photo.path,
      category: photo.category,
      storage: parseInt(photo.storage) || 0,
      type: "photo",
    });
  }

  // Add OBD2 images (only those with screenshot_path)
  for (const obd2 of obd2_codes) {
    if (obd2.screenshot_path) {
      allImages.push({
        id: obd2.id,
        path: obd2.converted_path || obd2.screenshot_path,
        category: "obd",
        storage: parseInt(obd2.storage) || 0,
        type: "obd2_image",
        code: obd2.code,
        description: obd2.description,
      });
    }
  }

  // Add title images
  for (const titleImg of titleImages) {
    if (titleImg.path) {
      allImages.push({
        id: titleImg.id,
        path: titleImg.converted_path || titleImg.path,
        category: "title",
        storage: parseInt(titleImg.storage) || 0,
        type: "title_image",
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
        images: [...currentChunk],
        totalSize: currentSize,
        chunkIndex: chunks.length,
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
      chunkIndex: chunks.length,
    });
  }

  return chunks;
}
