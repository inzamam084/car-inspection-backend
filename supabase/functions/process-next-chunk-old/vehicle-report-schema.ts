/**
 * Vehicle Report Schema for Gemini API structured output
 */

export const VEHICLE_REPORT_SCHEMA = {
  type: "OBJECT",
  properties: {
    vehicle: {
      type: "OBJECT",
      properties: {
        Make: {
          type: "STRING",
        },
        Model: {
          type: "STRING",
        },
        Year: {
          type: "INTEGER",
        },
        Engine: {
          type: "STRING",
        },
        Drivetrain: {
          type: "STRING",
        },
        "Title Status": {
          type: "STRING",
        },
        VIN: {
          type: "STRING",
        },
        Mileage: {
          type: "INTEGER",
          minimum: 0,
        },
        Location: {
          type: "STRING",
        },
        Transmission: {
          type: "STRING",
        },
        "Body Style": {
          type: "STRING",
        },
        "Exterior Color": {
          type: "STRING",
        },
        "Interior Color": {
          type: "STRING",
        },
        Fuel: {
          type: "STRING",
        },
      },
      required: [
        "Make",
        "Model",
        "Year",
        "Engine",
        "Drivetrain",
        "Title Status",
        "VIN",
        "Mileage",
        "Location",
        "Transmission",
        "Body Style",
        "Exterior Color",
        "Interior Color",
        "Fuel",
      ],
    },
    exterior: {
      type: "OBJECT",
      properties: {
        problems: {
          type: "ARRAY",
          items: {
            type: "STRING",
          },
        },
        score: {
          type: "NUMBER",
          minimum: 1,
          maximum: 10,
        },
        estimatedRepairCost: {
          type: "INTEGER",
          minimum: 0,
        },
        costExplanation: {
          type: "STRING",
        },
        incomplete: {
          type: "BOOLEAN",
        },
        incompletion_reason: {
          type: "STRING",
        },
      },
      required: [
        "problems",
        "score",
        "estimatedRepairCost",
        "costExplanation",
        "incomplete",
        "incompletion_reason",
      ],
    },
    interior: {
      type: "OBJECT",
      properties: {
        problems: {
          type: "ARRAY",
          items: {
            type: "STRING",
          },
        },
        score: {
          type: "NUMBER",
          minimum: 1,
          maximum: 10,
        },
        estimatedRepairCost: {
          type: "INTEGER",
          minimum: 0,
        },
        costExplanation: {
          type: "STRING",
        },
        incomplete: {
          type: "BOOLEAN",
        },
        incompletion_reason: {
          type: "STRING",
        },
      },
      required: [
        "problems",
        "score",
        "estimatedRepairCost",
        "costExplanation",
        "incomplete",
        "incompletion_reason",
      ],
    },
    dashboard: {
      type: "OBJECT",
      properties: {
        problems: {
          type: "ARRAY",
          items: {
            type: "STRING",
          },
        },
        score: {
          type: "NUMBER",
          minimum: 1,
          maximum: 10,
        },
        estimatedRepairCost: {
          type: "INTEGER",
          minimum: 0,
        },
        costExplanation: {
          type: "STRING",
        },
        incomplete: {
          type: "BOOLEAN",
        },
        incompletion_reason: {
          type: "STRING",
        },
      },
      required: [
        "problems",
        "score",
        "estimatedRepairCost",
        "costExplanation",
        "incomplete",
        "incompletion_reason",
      ],
    },
    paint: {
      type: "OBJECT",
      properties: {
        problems: {
          type: "ARRAY",
          items: {
            type: "STRING",
          },
        },
        score: {
          type: "NUMBER",
          minimum: 1,
          maximum: 10,
        },
        estimatedRepairCost: {
          type: "INTEGER",
          minimum: 0,
        },
        costExplanation: {
          type: "STRING",
        },
        incomplete: {
          type: "BOOLEAN",
        },
        incompletion_reason: {
          type: "STRING",
        },
      },
      required: [
        "problems",
        "score",
        "estimatedRepairCost",
        "costExplanation",
        "incomplete",
        "incompletion_reason",
      ],
    },
    rust: {
      type: "OBJECT",
      properties: {
        problems: {
          type: "ARRAY",
          items: {
            type: "STRING",
          },
        },
        score: {
          type: "NUMBER",
          minimum: 1,
          maximum: 10,
        },
        estimatedRepairCost: {
          type: "INTEGER",
          minimum: 0,
        },
        costExplanation: {
          type: "STRING",
        },
        incomplete: {
          type: "BOOLEAN",
        },
        incompletion_reason: {
          type: "STRING",
        },
      },
      required: [
        "problems",
        "score",
        "estimatedRepairCost",
        "costExplanation",
        "incomplete",
        "incompletion_reason",
      ],
    },
    engine: {
      type: "OBJECT",
      properties: {
        problems: {
          type: "ARRAY",
          items: {
            type: "STRING",
          },
        },
        score: {
          type: "NUMBER",
          minimum: 1,
          maximum: 10,
        },
        estimatedRepairCost: {
          type: "INTEGER",
          minimum: 0,
        },
        costExplanation: {
          type: "STRING",
        },
        incomplete: {
          type: "BOOLEAN",
        },
        incompletion_reason: {
          type: "STRING",
        },
      },
      required: [
        "problems",
        "score",
        "estimatedRepairCost",
        "costExplanation",
        "incomplete",
        "incompletion_reason",
      ],
    },
    undercarriage: {
      type: "OBJECT",
      properties: {
        problems: {
          type: "ARRAY",
          items: {
            type: "STRING",
          },
        },
        score: {
          type: "NUMBER",
          minimum: 1,
          maximum: 10,
        },
        estimatedRepairCost: {
          type: "INTEGER",
          minimum: 0,
        },
        costExplanation: {
          type: "STRING",
        },
        incomplete: {
          type: "BOOLEAN",
        },
        incompletion_reason: {
          type: "STRING",
        },
      },
      required: [
        "problems",
        "score",
        "estimatedRepairCost",
        "costExplanation",
        "incomplete",
        "incompletion_reason",
      ],
    },
    obd: {
      type: "OBJECT",
      properties: {
        codes: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              code: {
                type: "STRING",
              },
              problems: {
                type: "ARRAY",
                items: {
                  type: "STRING",
                },
              },
              score: {
                type: "NUMBER",
                minimum: 1,
                maximum: 10,
              },
              estimatedRepairCost: {
                type: "INTEGER",
                minimum: 0,
              },
              costExplanation: {
                type: "STRING",
              },
              incomplete: {
                type: "BOOLEAN",
              },
              incompletion_reason: {
                type: "STRING",
              },
            },
            required: [
              "code",
              "problems",
              "score",
              "estimatedRepairCost",
              "costExplanation",
              "incomplete",
              "incompletion_reason",
            ],
          },
        },
        overall: {
          type: "OBJECT",
          properties: {
            problems: {
              type: "ARRAY",
              items: {
                type: "STRING",
              },
            },
            score: {
              type: "NUMBER",
              minimum: 1,
              maximum: 10,
            },
            estimatedRepairCost: {
              type: "INTEGER",
              minimum: 0,
            },
            costExplanation: {
              type: "STRING",
            },
            incomplete: {
              type: "BOOLEAN",
            },
            incompletion_reason: {
              type: "STRING",
            },
          },
          required: [
            "problems",
            "score",
            "estimatedRepairCost",
            "costExplanation",
            "incomplete",
            "incompletion_reason",
          ],
        },
      },
      required: ["codes", "overall"],
    },
    title: {
      type: "OBJECT",
      properties: {
        problems: {
          type: "ARRAY",
          items: {
            type: "STRING",
          },
        },
        score: {
          type: "NUMBER",
          minimum: 1,
          maximum: 10,
        },
        estimatedRepairCost: {
          type: "INTEGER",
          minimum: 0,
        },
        costExplanation: {
          type: "STRING",
        },
        incomplete: {
          type: "BOOLEAN",
        },
        incompletion_reason: {
          type: "STRING",
        },
      },
      required: [
        "problems",
        "score",
        "estimatedRepairCost",
        "costExplanation",
        "incomplete",
        "incompletion_reason",
      ],
    },
    records: {
      type: "OBJECT",
      properties: {
        verifiedMaintenance: {
          type: "ARRAY",
          items: {
            type: "STRING",
          },
        },
        discrepancies: {
          type: "ARRAY",
          items: {
            type: "STRING",
          },
        },
        incomplete: {
          type: "BOOLEAN",
        },
        incompletion_reason: {
          type: "STRING",
        },
      },
      required: [
        "verifiedMaintenance",
        "discrepancies",
        "incomplete",
        "incompletion_reason",
      ],
    },
    overallConditionScore: {
      type: "NUMBER",
      minimum: 1,
      maximum: 10,
    },
    overallComments: {
      type: "STRING",
    },
  },
  required: [
    "vehicle",
    "exterior",
    "interior",
    "dashboard",
    "paint",
    "rust",
    "engine",
    "undercarriage",
    "obd",
    "title",
    "records",
    "overallConditionScore",
    "overallComments",
  ],
};
