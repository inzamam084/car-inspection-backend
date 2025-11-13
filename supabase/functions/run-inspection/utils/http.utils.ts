/**
 * Parses the JSON body of a request, with validation.
 * @param req The incoming Request object.
 * @returns A promise that resolves to the parsed payload.
 * @throws An error if the body is empty or invalid JSON.
 */
export async function parseRequestBody(req: Request): Promise<unknown> {
  const contentLength = req.headers.get("content-length");
  if (!contentLength || contentLength === "0") {
    throw new Error("Request body is required");
  }

  try {
    const text = await req.text();
    if (!text.trim()) {
      throw new Error("Request body is empty");
    }
    return JSON.parse(text);
  } catch (parseError) {
    console.error("JSON parsing error:", parseError);
    throw new Error("Invalid JSON in request body");
  }
}

