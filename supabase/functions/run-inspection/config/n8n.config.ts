// N8n configuration
export const N8N_CONFIG = {
  webhookUrl: Deno.env.get("N8N_WEBHOOK_URL") || "",
  apiKey: Deno.env.get("N8N_API_KEY") || "",
  workflowId: Deno.env.get("N8N_WORKFLOW_ID") || "",
};

