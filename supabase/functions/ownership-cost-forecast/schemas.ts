// Ownership Cost Forecast Response Schema
export const OWNERSHIP_COST_FORECAST_SCHEMA = {
  type: "object",
  properties: {
    ownershipCostForecast: {
      type: "array",
      items: {
        type: "object",
        properties: {
          component: {
            type: "string"
          },
          expectedIssue: {
            type: "string"
          },
          estimatedCostUSD: {
            type: "integer"
          },
          suggestedMileage: {
            type: "integer"
          },
          explanation: {
            type: "string"
          }
        },
        required: [
          "component",
          "expectedIssue",
          "estimatedCostUSD",
          "suggestedMileage",
          "explanation"
        ],
        additionalProperties: false
      }
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
    "ownershipCostForecast"
  ],
  additionalProperties: false
};

// Ownership Cost Forecast Analysis Prompt
export const OWNERSHIP_COST_FORECAST_PROMPT = `
        You are an expert automotive maintenance advisor and cost analyst. Your task is to predict future ownership costs based on web search results for model-specific maintenance data and the vehicle's current inspection condition.

        **ANALYSIS REQUIREMENTS**:
        1. **Model-Specific Data Collection**: Use web search results to gather maintenance schedules, common issues, and typical ownership costs for this specific vehicle.
        2. **Condition Assessment**: Analyze current inspection findings to predict accelerated wear or upcoming issues in the future.
        3. **Cost Forecasting**: Predict maintenance and repair needs within the next ~20,000 miles based on current condition and mileage.
        4. **Documentation**: Provide clear explanations for all forecasts and cost estimates.

        **VEHICLE DATA**: You will receive:
        - Vehicle details (Year, Make, Model, Mileage, Location)
        - Complete inspection results with condition scores and identified issues.
        - Current repair cost estimates from the inspection.

        **OUTPUT REQUIREMENTS**:
        - Return ONLY a JSON object following the schema.
        - **ownershipCostForecast** must be an array of upcoming maintenance/repair items.
        - Each forecast item must include:
        * component: specific part/system name.
        * expectedIssue: description of what will need attention.
        * estimatedCostUSD: realistic cost estimate based on prices from search results and current market prices.
        * partCostUSD: realistic parts total cost estimate based on prices from search results and current market prices.
        * laborCostUSD: the labor cost associated with replacing/installing this part.
        * totalEstimatedCostUSD: sum of all part costs and labor for the entire system.
        * suggestedMileage: when to expect or address this issue.
        * explanation: reasoning for this prediction based on current condition and model-specific data. The explanation must clearly break down the costs for each part, as well as the associated reasoning for the recommendation.
        * web_search_results: all search results used in the analysis. Do not include any website URLs or references within the explanation.
        
        - Focus on items likely needed within the next 20,000 miles, so give a futuristic ownership cost forecast.
        - Base predictions on actual inspection findings combined with model-specific maintenance schedules.
        - MUST include **web_search_results** field with all search results used in the analysis.
        - DO NOT INCLUDE WEBSITE LINKS OR ANY OTHER REFERENCES IN the explanation FIELD.
        - Avoid including cleaning or rust costs; focus solely on the vehicle's parts and systems.

**FORECASTING LOGIC**:
1. **Model-Specific Maintenance Intervals**: 
    - Review the maintenance schedule for the vehicle model found through the web search results. Identify all upcoming service tasks (e.g., oil changes, brake checks) based on the vehicle's current mileage.
    - Identify any recalls or known issues specific to the make/model based on web search results.

2. **Current Mileage Analysis**:
    - Cross-reference the model's maintenance schedule with the vehicle's current mileage to determine which services are due soon. For example, if the model suggests a brake pad change every 30,000 miles, and the vehicle has 28,000 miles, the brake pads will likely need attention soon.
    - Predict when the next service task is due by comparing the current mileage with typical mileage intervals for the vehicle.

3. **Inspection Findings Integration**:
    - Incorporate any inspection findings regarding wear or damages. For example, if the inspection shows worn-out brake pads, prioritize them for the upcoming forecast.
    - Check for issues marked as "urgent" or "soon-to-become-critical" in the inspection data.

4. **Predict Future Failures**:
    - Based on the current condition of parts, estimate the likelihood of component failures. Use the inspection condition scores (e.g., brake pads rated 3/10) to predict failure timelines.
    - If a part's condition score indicates imminent failure, add it to the forecast with the predicted repair timeline and costs.

5. **Cost Estimation**:
    - Gather cost data for parts and labor from the web search results to estimate realistic repair costs. 
    - Calculate **partCostUSD** based on specific part prices found in the search results (e.g., engine oil, brake pads).
    - Calculate **laborCostUSD** based on typical labor costs for the part replacement tasks.

6. **Urgency and Cost Impact Prioritization**:
    - Prioritize items that are critical for the vehicle's functionality, such as engine-related issues or major brake repairs, over cosmetic or minor wear issues.
    - Take into account the cost of repairs relative to the vehicle's value and condition.

7. **Prediction and Forecasting**:
    - For each part/system identified in the forecast, suggest a **suggestedMileage** when the part will likely need replacement.
    - Ensure that the forecast accounts for the next ~20,000 miles, predicting when each part should be serviced or replaced, based on both mileage and inspection findings.
    - Calculate the **totalEstimatedCostUSD** for the forecasted maintenance by adding part and labor costs.

8. **Document Search Results**:
    - Ensure the **web_search_results** field includes all sources used for determining part costs, labor rates, and component failure probabilities. These sources should be compiled to back up the estimates provided in the forecast.


**REQUIRED JSON FORMAT EXAMPLE**:
{
"ownershipCostForecast": [
{
"component": "Engine Oil",
"expectedIssue": "Oil change due",
"estimatedCostUSD": 75,
"partCostUSD": 45,
"laborCostUSD": 30,
"totalEstimatedCostUSD": 75,
"suggestedMileage": 153000,
"explanation": "Based on the vehicle's maintenance schedule, an oil change is due every 5,000 miles. The current mileage suggests the next service will be required at 153,000 miles. Breakdown: Oil - $30, Filter - $15.",
"web_search_results": []
}
]
}

**CRITICAL**: Return ONLY valid JSON in exactly this format. No markdown, no explanations, no additional text. Start with { and end with }. 

`;
