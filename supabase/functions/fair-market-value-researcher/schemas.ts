// Fair Market Value Response Schema
export const FAIR_MARKET_VALUE_SCHEMA = {
  type: "object",
  properties: {
    finalFairValueUSD: {
      type: "string",
      description: "Final fair market value in USD format (e.g., '$15,000 - $18,000' or '$16,500')"
    },
    priceAdjustment: {
      type: "object",
      properties: {
        baselineBand: {
          type: "string",
          enum: [
            "concours",
            "excellent",
            "good",
            "fair"
          ]
        },
        adjustmentUSD: {
          type: "integer"
        },
        explanation: {
          type: "string"
        }
      },
      required: [
        "baselineBand",
        "adjustmentUSD",
        "explanation"
      ],
      additionalProperties: false
    },
    web_search_results: {
      type: "array",
      description: "All web search results used in the analysis",
      items: {
        type: "object",
        additionalProperties: false
      }
    }
  },
  required: [
    "finalFairValueUSD",
    "priceAdjustment"
  ],
  additionalProperties: false
};

// Fair Market Value Analysis Prompt
export const FAIR_MARKET_VALUE_PROMPT = `You are an expert automotive appraiser and market analyst. Your task is to determine the fair market value of a vehicle based on web search results and the vehicle's inspection condition.

**ANALYSIS REQUIREMENTS**:
1. **Market Data Collection**: Use web search results to establish baseline market values from multiple sources
2. **Condition Assessment**: Apply condition-based adjustments based on the provided inspection results
3. **Price Calculation**: Determine a specific dollar amount or range for finalFairValueUSD
4. **Documentation**: Provide clear explanations for all adjustments and market analysis

**VEHICLE DATA**: You will receive:
- Vehicle details (Year, Make, Model, Mileage, Location)
- Complete inspection results with condition scores and identified issues
- Repair cost estimates from the inspection

**OUTPUT REQUIREMENTS**:
- Return ONLY a JSON object following the schema
- priceAdjustment should consider all adjustable prices in the report including OBD2 codes. 
- finalFairValueUSD must be a specific dollar amount or narrow range (e.g., "$start_amount_range - $end_amount_range" or "$exact_amount")
- DO NOT return "Market Data Not Available" unless all searches completely fail
- Base adjustments on actual inspection findings and market data
- Provide detailed explanations for price adjustments
- MUST include web_search_results field with all search results you used in your analysis

**PRICING LOGIC**:
1. Start with baseline market value from web searches
2. Apply condition adjustments based on inspection scores and repair costs
3. Consider regional market factors from location data
4. Factor in any significant issues or advantages found in inspection

Return only the JSON response with no additional text or markdown.`;
