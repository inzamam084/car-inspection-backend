/**
 * Gemini AI Service
 * Handles natural language filter extraction and listing ranking using Google's Gemini API
 */

import { logInfo, logError, logDebug } from "../utils/logger.ts";

// const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const GEMINI_API_KEY = "AIzaSyC5HsGQ48tgff_uehN_TwjJ3t182azAJ-w";
const GEMINI_MODEL = "gemini-2.0-flash-exp";

export interface GenerateFiltersRequest {
  description: string;
  platformName: string;
  availableFilters: Record<string, { label: string; type: string; dataType: string }>;
}

export interface GenerateFiltersResponse {
  success: boolean;
  filters?: Record<string, string | boolean>;
  error?: string;
}

export interface RankListingsRequest {
  description: string;
  listings: any[];
}

export interface RankListingsResponse {
  success: boolean;
  rankedListings?: {
    index: number;
    reasoning: string;
    score: number;
  }[];
  error?: string;
}

/**
 * Build prompt for filter extraction
 */
function buildFilterPrompt(
  description: string,
  platformName: string,
  availableFilters: Record<string, { label: string; type: string; dataType: string }>
): string {
  const filtersList = Object.entries(availableFilters)
    .map(([key, config]) => `  - ${key} ("${config.label}"): ${config.dataType}`)
    .join("\n");

  return `You are an intelligent filter extraction assistant for vehicle search platforms. Your task is to analyze user descriptions and extract the appropriate search filters for ${platformName}.

**Available Filters:**
${filtersList}

**User Description:**
"${description}"

**Extraction Rules:**

1. **Output Format**: Return ONLY a valid JSON object. No markdown, no explanations, no code blocks.

2. **Filter Key Matching**:
   - Use EXACT filter keys from the available list above
   - Match user intent to the most appropriate filter keys
   - Look for semantic matches (e.g., "year range" → year_min/year_max OR min_auto_year/max_auto_year)

3. **Data Type Handling**:
   - Boolean filters (checkboxes): Set to true if mentioned (NEVER use false, omit instead)
   - Number filters: Extract as strings (e.g., "2015", "50000", "15000")
   - String filters: Extract as lowercase text (e.g., "honda civic", "sedan")

4. **Smart Value Extraction**:
   - Make/Model: Combine brand and model into one value if single field exists
   - Price: Remove currency symbols, use min/max appropriately
   - Year: Handle phrases like "from X to Y", "between X and Y", "newer than X"
   - Mileage/Odometer: Convert to numbers, handle "k" notation (e.g., "100k" → "100000")
   - Transmission: "automatic" → transmission_automatic:true, "manual" → transmission_manual:true
   - Drive: "fwd"/"front wheel" → drive_fwd:true, "awd"/"all wheel" → drive_awd:true, etc.
   - Title: "clean title" → title_clean:true, "salvage" → title_salvage:true
   - Condition: Match phrases to available condition filters
   - Body Style: "suv" → body_suv:true, "sedan" → body_sedan:true, etc.
   - Fuel Type: "gas"/"gasoline" → fuel_gasoline:true, "diesel" → fuel_diesel:true, etc.
   - Color: Match color names to available color filters

5. **Context Awareness**:
   - Only include filters explicitly mentioned or strongly implied
   - Omit filters not relevant to the description
   - Infer reasonable defaults when user intent is clear (e.g., "Honda Civic" should use make_model or auto_make_model)

6. **Platform-Specific Adaptation**:
   - Check which filters are available and adapt accordingly
   - For year ranges: use year_min/year_max OR min_auto_year/max_auto_year based on availability
   - For price: use min_price/max_price if available
   - For mileage: use odometer_min/odometer_max OR min_auto_miles/max_auto_miles based on availability

**Examples:**

Input: "Honda Civics from 2015 to 2020 under $15000 with automatic transmission and clean title"
Output: {"auto_make_model":"honda civic","min_auto_year":"2015","max_auto_year":"2020","max_price":"15000","transmission_automatic":true,"title_clean":true}

Input: "2018-2022 Toyota Camry, FWD, less than 60k miles, silver or white color"
Output: {"make":"Toyota","model":"Camry","year_min":"2018","year_max":"2022","odometer_max":"60000","drive_fwd":true,"color_silver":true,"color_white":true}

Input: "Ford F-150 trucks, salvage title, under 100k miles, 4WD"
Output: {"make":"Ford","model":"F-150","body_truck":true,"title_salvage":true,"odometer_max":"100000","drive_4wd":true}

**Now process the user description and return ONLY the JSON object:**`;
}

/**
 * Build prompt for ranking listings
 */
function buildRankingPrompt(description: string, listings: any[]): string {
  // Prepare simplified listing data for Gemini to reduce token usage
  const simplifiedListings = listings.map((item) => ({
    index: item.index,
    url: item.url || "Unknown URL",
    vin: item.data?.vin || "N/A",
    mileage: item.data?.mileage || "N/A",
    notes: (item.data?.notes || "No notes available").substring(0, 300),
    images_count: item.data?.gallery_images?.length || 0,
    obdii_codes: item.data?.obdii_codes || "N/A",
  }));

  return `You are an expert vehicle purchasing assistant.
User is looking for: "${description}"

I have found ${simplifiedListings.length} listings. Please analyze them and identify the TOP 5 best matches.

Listings Data:
${JSON.stringify(simplifiedListings, null, 2)}

Task:
1. Analyze each listing against the user's requirements based on available data (VIN, mileage, notes, OBDII codes).
2. Use the 'notes' field which contains vehicle details, condition, title information, etc.
3. Select the top 5 listings that best match the criteria.
4. Provide a brief reasoning for each selection (1-2 sentences maximum).
5. Assign a relevance score from 0-100 based on how well it matches the user's criteria.

Important:
- If a listing has very limited data (no VIN, no notes), assign a low score (10-30).
- Higher mileage should generally result in lower scores unless user specifically wants high mileage.
- Look for keywords in notes that match user's requirements (make, model, year, condition, etc.).
- Clean title mentions in notes should increase score if user wants clean title.

Output Format:
Return ONLY a valid JSON array of objects with this structure:
[
  {
    "index": <original_index_number>,
    "reasoning": "<brief_explanation_why_this_is_a_good_match>",
    "score": <0-100>
  }
]
Sort the array by score descending (best matches first). Return ONLY the JSON array, no other text.`;
}

/**
 * Call Gemini API with retry logic
 */
async function callGeminiAPI(
  prompt: string,
  temperature: number,
  maxOutputTokens: number,
  requestId: string
): Promise<any> {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY environment variable is not set");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  logDebug(requestId, "Calling Gemini API", {
    model: GEMINI_MODEL,
    temperature,
    maxOutputTokens,
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: prompt,
            },
          ],
        },
      ],
      generationConfig: {
        temperature,
        maxOutputTokens,
      },
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    logError(requestId, "Gemini API error", {
      status: response.status,
      error: errorData,
    });
    throw new Error(
      `Gemini API error: ${response.status} - ${errorData.error?.message || "Unknown error"}`
    );
  }

  const data = await response.json();
  logDebug(requestId, "Gemini API response received");

  return data;
}

/**
 * Parse and clean Gemini response
 */
function parseGeminiResponse(data: any, requestId: string): string {
  const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

  if (!textContent) {
    logError(requestId, "No content returned from Gemini API");
    throw new Error("No content returned from Gemini API");
  }

  // Clean up response - remove markdown code blocks if present
  let cleanedText = textContent.trim();
  if (cleanedText.startsWith("```json")) {
    cleanedText = cleanedText.replace(/^```json\s*/, "").replace(/```\s*$/, "");
  } else if (cleanedText.startsWith("```")) {
    cleanedText = cleanedText.replace(/^```\s*/, "").replace(/```\s*$/, "");
  }

  return cleanedText;
}

/**
 * Generate filters from natural language description using Gemini
 */
export async function generateFiltersWithGemini(
  request: GenerateFiltersRequest,
  requestId: string
): Promise<GenerateFiltersResponse> {
  const { description, platformName, availableFilters } = request;

  logInfo(requestId, "Generating filters with Gemini", {
    platform: platformName,
    descriptionLength: description.length,
    filterCount: Object.keys(availableFilters).length,
  });

  try {
    // Validate input
    if (!description.trim()) {
      return {
        success: false,
        error: "Description cannot be empty",
      };
    }

    // Build prompt
    const prompt = buildFilterPrompt(description, platformName, availableFilters);

    // Call Gemini API
    const data = await callGeminiAPI(prompt, 0.1, 1024, requestId);

    // Parse response
    const cleanedText = parseGeminiResponse(data, requestId);

    // Parse JSON
    let filters: Record<string, string | boolean>;
    try {
      filters = JSON.parse(cleanedText);
    } catch (parseError) {
      logError(requestId, "Failed to parse Gemini response as JSON", {
        error: parseError,
        rawText: cleanedText,
      });
      return {
        success: false,
        error: "Failed to parse AI response. Please try rephrasing your description.",
      };
    }

    // Validate that returned keys are in available filters
    const validKeys = Object.keys(availableFilters);
    const invalidKeys = Object.keys(filters).filter(
      (key) => !validKeys.includes(key)
    );

    if (invalidKeys.length > 0) {
      logDebug(requestId, "AI returned invalid filter keys", { invalidKeys });
      // Remove invalid keys
      invalidKeys.forEach((key) => delete filters[key]);
    }

    if (Object.keys(filters).length === 0) {
      return {
        success: false,
        error: "No valid filters could be extracted. Please try being more specific.",
      };
    }

    logInfo(requestId, "Filters generated successfully", {
      filterCount: Object.keys(filters).length,
    });

    return {
      success: true,
      filters,
    };
  } catch (error) {
    const { message } = error as Error;
    logError(requestId, "Error generating filters", { error: message });
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Rank listings based on user description using Gemini
 */
export async function rankListingsWithGemini(
  request: RankListingsRequest,
  requestId: string
): Promise<RankListingsResponse> {
  const { description, listings } = request;

  logInfo(requestId, "Ranking listings with Gemini", {
    listingCount: listings.length,
  });

  try {
    // Validate input
    if (!listings || listings.length === 0) {
      return {
        success: false,
        error: "No listings to rank",
      };
    }

    // Build prompt
    const prompt = buildRankingPrompt(description, listings);

    // Call Gemini API
    const data = await callGeminiAPI(prompt, 0.2, 2048, requestId);

    // Parse response
    const cleanedText = parseGeminiResponse(data, requestId);

    // Parse JSON
    let rankedListings: Array<{
      index: number;
      reasoning: string;
      score: number;
    }>;

    try {
      rankedListings = JSON.parse(cleanedText);
    } catch (parseError) {
      logError(requestId, "Failed to parse Gemini ranking response", {
        error: parseError,
        rawText: cleanedText,
      });
      return {
        success: false,
        error: "Failed to parse AI ranking response.",
      };
    }

    logInfo(requestId, "Listings ranked successfully", {
      rankedCount: rankedListings.length,
    });

    return {
      success: true,
      rankedListings,
    };
  } catch (error) {
    const { message } = error as Error;
    logError(requestId, "Error ranking listings", { error: message });
    return {
      success: false,
      error: message,
    };
  }
}
