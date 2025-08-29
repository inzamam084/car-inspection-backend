
/**
 * Generate a categorized filename for image storage
 */
export function generateCategorizedFilename(
  originalUrl: string, 
  lotId: string, 
  category: string
): string {
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(2, 15);
  return `${category}_${timestamp}_${randomId}.jpg`;
}

/**
 * Get appropriate referer for different auction sites
 */
export function getRefererForUrl(url: string): string {
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

/**
 * Generate random delay between min and max milliseconds
 */
export function getRandomDelay(min: number, max: number): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, delay));
}
