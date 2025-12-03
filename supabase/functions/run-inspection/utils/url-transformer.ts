/**
 * Domain-specific URL transformations for higher quality images
 */

/**
 * Transform Copart image URLs from full quality to high-resolution quality
 * Converts:
 *   - _ful.jpg -> _hrs.jpg (full to high-resolution)
 *   - _vful.jpg -> _vhrs.jpg (video full to video high-resolution)
 *   - _thb.jpg -> _hrs.jpg (thumbnail to high-resolution, used by autobidmaster.com)
 *
 * @param url - Original Copart image URL
 * @returns Transformed URL with high-resolution suffix
 *
 * @example
 * transformCopartUrl('https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/1125/e2b3571a27b24042ac08300185896044_ful.jpg')
 * // Returns: 'https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/1125/e2b3571a27b24042ac08300185896044_hrs.jpg'
 *
 * @example
 * transformCopartUrl('https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/1125/9364be2f40274b28a193220b75f31c70_vful.jpg')
 * // Returns: 'https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/1125/9364be2f40274b28a193220b75f31c70_vhrs.jpg'
 *
 * @example
 * transformCopartUrl('https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/1125/0216541646b44b33b5e2ff56eb71bf8b_thb.jpg')
 * // Returns: 'https://cs.copart.com/v1/AUTH_svc.pdoc00001/ids-c-prod-lpp/1125/0216541646b44b33b5e2ff56eb71bf8b_hrs.jpg'
 */
function transformCopartUrl(url: string): string {
  // Replace _vful.jpg with _vhrs.jpg for video high-resolution images
  if (url.includes('_vful.jpg')) {
    return url.replace('_vful.jpg', '_vhrs.jpg');
  }

  // Replace _ful.jpg with _hrs.jpg for high-resolution images
  if (url.includes('_ful.jpg')) {
    return url.replace('_ful.jpg', '_hrs.jpg');
  }

  // Replace _thb.jpg with _hrs.jpg for thumbnail to high-resolution (autobidmaster.com)
  if (url.includes('_thb.jpg')) {
    return url.replace('_thb.jpg', '_hrs.jpg');
  }

  return url;
}

/**
 * Transform Craigslist image URLs from thumbnail to high resolution
 * Converts: _50x50c.jpg -> _1200x900.jpg (or any size variant to 1200x900)
 *
 * @param url - Original Craigslist image URL
 * @returns Transformed URL with high-resolution dimensions
 *
 * @example
 * transformCraigslistUrl('https://images.craigslist.org/00c0c_EelmbGZ5IY_0cU09G_50x50c.jpg')
 * // Returns: 'https://images.craigslist.org/00c0c_EelmbGZ5IY_0cU09G_1200x900.jpg'
 */
function transformCraigslistUrl(url: string): string {
  // Match any Craigslist image with size format (e.g., _50x50c.jpg, _300x300.jpg, _600x450.jpg)
  // and replace with _1200x900.jpg for maximum quality
  const sizePattern = /_\d+x\d+c?\.jpg$/i;

  if (sizePattern.test(url)) {
    return url.replace(sizePattern, '_1200x900.jpg');
  }

  return url;
}

/**
 * Transform Hagerty image URLs to maximum width
 * Converts: w=300 -> w=1200 (or any width to maximum 1200)
 *
 * @param url - Original Hagerty image URL
 * @returns Transformed URL with maximum width parameter
 *
 * @example
 * transformHagertyUrl('https://hagerty-marketplace-prod.imgix.net/assets/4sNQG_I3qN8d9erEwKUF0Q.jpg?q=70&auto=format%2Ccompress&cs=srgb&w=300')
 * // Returns: 'https://hagerty-marketplace-prod.imgix.net/assets/4sNQG_I3qN8d9erEwKUF0Q.jpg?q=70&auto=format%2Ccompress&cs=srgb&w=1200'
 */
function transformHagertyUrl(url: string): string {
  // Replace any w=<number> parameter with w=1200 for maximum width
  const widthPattern = /([?&])w=\d+/i;

  if (widthPattern.test(url)) {
    return url.replace(widthPattern, '$1w=1200');
  }

  return url;
}

/**
 * Transform Cars & Bids image URLs to maximum quality
 * Converts CDN parameters: width=456 -> width=2080, quality=70 -> quality=100
 *
 * @param url - Original Cars & Bids image URL
 * @returns Transformed URL with maximum width and quality
 *
 * @example
 * transformCarsAndBidsUrl('https://media.carsandbids.com/cdn-cgi/image/width=456,quality=70/171ab1e538119e13fa98382f268326fc825fdc20/photos/rkDYnjDb-ozInFhgFdJ/edit/wlkzw.jpg?t=176290837567')
 * // Returns: 'https://media.carsandbids.com/cdn-cgi/image/width=2080,quality=100/171ab1e538119e13fa98382f268326fc825fdc20/photos/rkDYnjDb-ozInFhgFdJ/edit/wlkzw.jpg?t=176290837567'
 */
function transformCarsAndBidsUrl(url: string): string {
  let transformedUrl = url;

  // Replace width parameter (e.g., width=456 -> width=2080)
  const widthPattern = /width=\d+/i;
  if (widthPattern.test(transformedUrl)) {
    transformedUrl = transformedUrl.replace(widthPattern, 'width=2080');
  }

  // Replace quality parameter (e.g., quality=70 -> quality=100)
  const qualityPattern = /quality=\d+/i;
  if (qualityPattern.test(transformedUrl)) {
    transformedUrl = transformedUrl.replace(qualityPattern, 'quality=100');
  }

  return transformedUrl;
}

/**
 * Transform AutoTrader image URLs to maximum resolution
 * Converts query parameters: width=488 -> width=1600, height=366 -> height=1200
 * Note: Replaces ALL occurrences of width and height parameters
 *
 * @param url - Original AutoTrader image URL
 * @returns Transformed URL with maximum width and height
 *
 * @example
 * transformAutoTraderUrl('https://images2.autotrader.com/hn/c/5a6cbf7440114de3a878c70469d29aa5.jpg?format=auto&width=488&height=366&format=auto&width=800&height=600')
 * // Returns: 'https://images2.autotrader.com/hn/c/5a6cbf7440114de3a878c70469d29aa5.jpg?format=auto&width=1600&height=1200&format=auto&width=1600&height=1200'
 */
function transformAutoTraderUrl(url: string): string {
  let transformedUrl = url;

  // Replace ALL occurrences of width parameter with width=1600
  const widthPattern = /width=\d+/gi;
  transformedUrl = transformedUrl.replace(widthPattern, 'width=1600');

  // Replace ALL occurrences of height parameter with height=1200
  const heightPattern = /height=\d+/gi;
  transformedUrl = transformedUrl.replace(heightPattern, 'height=1200');

  return transformedUrl;
}

/**
 * Transform Bring a Trailer image URLs to high quality
 * Removes resize parameter and replaces with w=1200 for maximum quality
 *
 * @param url - Original Bring a Trailer image URL
 * @returns Transformed URL with high-quality width parameter
 *
 * @example
 * transformBringATrailerUrl('https://bringatrailer.com/wp-content/uploads/2025/11/DSC03984-16487-scaled.jpg?resize=155%2C105')
 * // Returns: 'https://bringatrailer.com/wp-content/uploads/2025/11/DSC03984-16487-scaled.jpg?w=1200'
 */
function transformBringATrailerUrl(url: string): string {
  // Remove resize parameter and replace with w=1200
  const resizePattern = /[?&]resize=[^&]+/i;

  if (resizePattern.test(url)) {
    // Remove resize parameter
    let transformedUrl = url.replace(resizePattern, '');

    // Add w=1200 parameter
    const hasQuery = transformedUrl.includes('?');
    transformedUrl += hasQuery ? '&w=1200' : '?w=1200';

    return transformedUrl;
  }

  // If no resize parameter, just add w=1200 if not already present
  if (!url.includes('w=')) {
    const hasQuery = url.includes('?');
    return url + (hasQuery ? '&w=1200' : '?w=1200');
  }

  return url;
}

/**
 * Transform CarMax image URLs to maximum resolution
 * Converts query parameters: width=400 -> width=1600, height=300 -> height=1200
 *
 * @param url - Original CarMax image URL
 * @returns Transformed URL with maximum width and height
 *
 * @example
 * transformCarMaxUrl('https://img2.carmax.com/assets/28028965/image/10.jpg?width=400&height=300')
 * // Returns: 'https://img2.carmax.com/assets/28028965/image/10.jpg?width=1600&height=1200'
 */
function transformCarMaxUrl(url: string): string {
  let transformedUrl = url;

  // Replace width parameter with width=1600
  const widthPattern = /width=\d+/gi;
  transformedUrl = transformedUrl.replace(widthPattern, 'width=1600');

  // Replace height parameter with height=1200
  const heightPattern = /height=\d+/gi;
  transformedUrl = transformedUrl.replace(heightPattern, 'height=1200');

  return transformedUrl;
}

/**
 * Check if URL is from Copart domain
 */
function isCopartUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.includes('copart.com');
  } catch {
    return false;
  }
}

/**
 * Check if URL is from Craigslist domain
 */
function isCraigslistUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.includes('craigslist.org');
  } catch {
    return false;
  }
}

/**
 * Check if URL is from Hagerty domain
 */
function isHagertyUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.includes('hagerty') && urlObj.hostname.includes('imgix.net');
  } catch {
    return false;
  }
}

/**
 * Check if URL is from Cars & Bids domain
 */
function isCarsAndBidsUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.includes('carsandbids.com');
  } catch {
    return false;
  }
}

/**
 * Check if URL is from AutoTrader domain
 */
function isAutoTraderUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.includes('autotrader.com');
  } catch {
    return false;
  }
}

/**
 * Check if URL is from Bring a Trailer domain
 */
function isBringATrailerUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.includes('bringatrailer.com');
  } catch {
    return false;
  }
}

/**
 * Check if URL is from CarMax domain
 */
function isCarMaxUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.includes('carmax.com');
  } catch {
    return false;
  }
}

/**
 * Transform Manheim (Fyuse) image URLs to high quality
 * - Removes _thumb suffix from the filename (Fyuse CDN)
 * - Removes size query parameter (Manheim CDN)
 *
 * @param url - Original Manheim/Fyuse image URL
 * @returns Transformed URL without _thumb suffix or size parameter
 *
 * @example
 * transformManheimUrl('https://i.fyuse.com/group/m2nmnppabvii728n/n103xkfmc4y2i/snaps/key_16_146190_thumb.jpg')
 * // Returns: 'https://i.fyuse.com/group/m2nmnppabvii728n/n103xkfmc4y2i/snaps/key_16_146190.jpg'
 *
 * @example
 * transformManheimUrl('https://images.cdn.manheim.com/20251202211058-17b1de5d-b3f2-4646-b0ec-44f6dc16b48b.jpg?size=w86h64')
 * // Returns: 'https://images.cdn.manheim.com/20251202211058-17b1de5d-b3f2-4646-b0ec-44f6dc16b48b.jpg'
 */
function transformManheimUrl(url: string): string {
  let transformedUrl = url;

  // Remove _thumb suffix before the file extension (Fyuse CDN)
  const thumbPattern = /_thumb\.jpg$/i;
  if (thumbPattern.test(transformedUrl)) {
    transformedUrl = transformedUrl.replace(thumbPattern, '.jpg');
  }

  // Remove size query parameter (Manheim CDN: ?size=w86h64)
  const sizePattern = /[?&]size=[^&]+/i;
  if (sizePattern.test(transformedUrl)) {
    transformedUrl = transformedUrl.replace(sizePattern, '');
    // Clean up trailing ? or & if they exist
    transformedUrl = transformedUrl.replace(/[?&]$/, '');
  }

  return transformedUrl;
}

/**
 * Check if URL is from Manheim/Fyuse domain
 */
function isManheimUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.includes('fyuse.com') ||
           urlObj.hostname.includes('manheim.com');
  } catch {
    return false;
  }
}

/**
 * Transform image URL based on domain for higher quality
 * Currently supports:
 * - Copart (cs.copart.com): _ful.jpg -> _hrs.jpg, _vful.jpg -> _vhrs.jpg, _thb.jpg -> _hrs.jpg
 * - Craigslist: _50x50c.jpg -> _1200x900.jpg (any size to max resolution)
 * - Hagerty (hagerty-marketplace-prod.imgix.net): w=300 -> w=1200 (query param width)
 * - Cars & Bids (media.carsandbids.com): width=456 -> width=2080, quality=70 -> quality=100
 * - AutoTrader (images2.autotrader.com): width=800 -> width=1600, height=600 -> height=1200
 * - Bring a Trailer (bringatrailer.com): resize=155%2C105 -> w=1200
 * - CarMax (img2.carmax.com): width=400 -> width=1600, height=300 -> height=1200
 * - Manheim (i.fyuse.com, images.cdn.manheim.com): _thumb.jpg removed, size query param removed
 *
 * Note: autobidmaster.com uses Copart's CDN (cs.copart.com), so transformations apply
 *
 * @param url - Original image URL from listing site
 * @returns Transformed URL optimized for quality, or original URL if no transformation needed
 */
export function transformImageUrl(url: string): string {
  if (isCopartUrl(url)) {
    return transformCopartUrl(url);
  }

  if (isCraigslistUrl(url)) {
    return transformCraigslistUrl(url);
  }

  if (isHagertyUrl(url)) {
    return transformHagertyUrl(url);
  }

  if (isCarsAndBidsUrl(url)) {
    return transformCarsAndBidsUrl(url);
  }

  if (isAutoTraderUrl(url)) {
    return transformAutoTraderUrl(url);
  }

  if (isBringATrailerUrl(url)) {
    return transformBringATrailerUrl(url);
  }

  if (isCarMaxUrl(url)) {
    return transformCarMaxUrl(url);
  }

  if (isManheimUrl(url)) {
    return transformManheimUrl(url);
  }

  // Add more domain-specific transformations here as needed
  // if (isOtherDomain(url)) {
  //   return transformOtherDomainUrl(url);
  // }

  return url;
}

/**
 * Extract domain from URL for logging/analytics
 */
export function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return 'unknown';
  }
}
