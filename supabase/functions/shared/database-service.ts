import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";

// Database service class with query optimization
export class DatabaseService {
  private client: SupabaseClient;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.client = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
      },
    });
  }

  // Batch fetch multiple related entities in a single query
  async batchFetchInspectionData(inspectionId: string) {
    const { data, error } = await this.client
      .from("inspections")
      .select(
        `
        id,
        vin,
        email,
        mileage,
        zip,
        type,
        url,
        photos (
          id,
          category,
          path,
          storage,
          converted_path
        ),
        obd2_codes (
          id,
          code,
          description,
          screenshot_path,
          storage,
          converted_path
        ),
        title_images (
          id,
          path,
          storage,
          converted_path
        )
      `
      )
      .eq("id", inspectionId)
      .single();

    return { data, error };
  }

  // Batch create processing jobs
  async batchCreateProcessingJobs(jobs: any[]) {
    const { data, error } = await this.client
      .from("processing_jobs")
      .insert(jobs)
      .select("id, sequence_order, job_type");

    return { data, error };
  }

  // Batch fetch completed jobs for final report
  async batchFetchCompletedJobs(inspectionId: string) {
    const { data, error } = await this.client
      .from("processing_jobs")
      .select(
        "job_type, chunk_result, sequence_order, cost, total_tokens, web_search_count, web_search_results"
      )
      .eq("inspection_id", inspectionId)
      .eq("status", "completed")
      .order("sequence_order", { ascending: true });

    return { data, error };
  }

  // Optimized job queue query
  async getNextPendingJob(inspectionId: string, completedSequence: number) {
    const { data, error } = await this.client
      .from("processing_jobs")
      .select("*")
      .eq("inspection_id", inspectionId)
      .eq("status", "pending")
      .gt("sequence_order", completedSequence)
      .order("sequence_order", { ascending: true })
      .limit(1)
      .maybeSingle();

    return { data, error };
  }

  // Update inspection status
  async updateInspectionStatus(
    inspectionId: string,
    status: string,
    additionalData: any = {}
  ) {
    const updateData = {
      status,
      ...additionalData,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.client
      .from("inspections")
      .update(updateData)
      .eq("id", inspectionId)
      .select("id, status");

    return { data, error };
  }

  // Batch update converted paths for HEIC conversion
  async batchUpdateConvertedPaths(
    updates: Array<{
      table: "photos" | "obd2_codes" | "title_images";
      id: string;
      convertedPath: string;
    }>
  ) {
    // Group updates by table
    const groupedUpdates = updates.reduce((acc, update) => {
      if (!acc[update.table]) {
        acc[update.table] = [];
      }
      acc[update.table].push({
        id: update.id,
        converted_path: update.convertedPath,
      });
      return acc;
    }, {} as Record<string, Array<{ id: string; converted_path: string }>>);

    // Execute batch updates for each table
    const promises = Object.entries(groupedUpdates).map(
      async ([table, tableUpdates]) => {
        const updatePromises = tableUpdates.map((update) =>
          this.client
            .from(table)
            .update({ converted_path: update.converted_path })
            .eq("id", update.id)
        );

        return Promise.all(updatePromises);
      }
    );

    try {
      const results = await Promise.all(promises);
      const hasError = results.flat().some((result) => result.error);

      return {
        data: hasError ? null : results,
        error: hasError ? results.flat().find((r) => r.error)?.error : null,
      };
    } catch (error) {
      return { data: null, error };
    }
  }

  // Update job with results
  async updateJobWithResults(
    jobId: string,
    updateData: {
      status: string;
      chunkResult?: any;
      cost?: number;
      totalTokens?: number;
      webSearchCount?: number;
      webSearchResults?: any[];
      errorMessage?: string;
    }
  ) {
    const data: any = {
      status: updateData.status,
      ...(updateData.chunkResult && { chunk_result: updateData.chunkResult }),
      ...(updateData.cost !== undefined && { cost: updateData.cost }),
      ...(updateData.totalTokens !== undefined && {
        total_tokens: updateData.totalTokens,
      }),
      ...(updateData.webSearchCount !== undefined && {
        web_search_count: updateData.webSearchCount,
      }),
      ...(updateData.webSearchResults && {
        web_search_results: updateData.webSearchResults,
      }),
      ...(updateData.errorMessage && {
        error_message: updateData.errorMessage,
      }),
    };

    if (updateData.status === "processing") {
      data.started_at = new Date().toISOString();
    } else if (
      updateData.status === "completed" ||
      updateData.status === "failed"
    ) {
      data.completed_at = new Date().toISOString();
    }

    const { data: result, error } = await this.client
      .from("processing_jobs")
      .update(data)
      .eq("id", jobId)
      .select("id, status");

    return { data: result, error };
  }

  // Get final chunk analysis result
  async getFinalChunkResult(inspectionId: string) {
    const { data, error } = await this.client
      .from("processing_jobs")
      .select("chunk_result, sequence_order")
      .eq("inspection_id", inspectionId)
      .eq("job_type", "chunk_analysis")
      .eq("status", "completed")
      .order("sequence_order", { ascending: false })
      .limit(1)
      .single();

    return { data, error };
  }

  // Create or update report
  async createOrUpdateReport(inspectionId: string, reportData: any) {
    // Check if report exists
    const { data: existingReport } = await this.client
      .from("reports")
      .select("id")
      .eq("inspection_id", inspectionId)
      .maybeSingle();

    if (existingReport) {
      const { data, error } = await this.client
        .from("reports")
        .update({
          ...reportData,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingReport.id)
        .select("id");

      return { data, error };
    } else {
      const { data, error } = await this.client
        .from("reports")
        .insert({
          inspection_id: inspectionId,
          ...reportData,
        })
        .select("id")
        .single();

      return { data, error };
    }
  }

  // Get the underlying client for direct access when needed
  getClient(): SupabaseClient {
    return this.client;
  }
}

// Factory function to create database service instance
export function createDatabaseService(
  supabaseUrl?: string,
  supabaseKey?: string
): DatabaseService {
  const url = supabaseUrl || Deno.env.get("SUPABASE_URL") || "";
  const key = supabaseKey || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  if (!url || !key) {
    throw new Error("Supabase URL and Service Role Key are required");
  }

  return new DatabaseService(url, key);
}

// Create Supabase client for authentication
export function createAuthClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Supabase URL and Anon Key are required for authentication"
    );
  }

  return createClient(supabaseUrl, supabaseAnonKey);
}

// Helper function to authenticate user from request
export async function authenticateUser(request: Request): Promise<{
  user: any | null;
  error: string | null;
}> {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader) {
      return {
        user: null,
        error: "No authorization header",
      };
    }

    // Create Supabase client for authentication
    const supabase = createAuthClient();

    // Get the user from the JWT token
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));

    if (userError || !user) {
      return {
        user: null,
        error: userError?.message || "Authentication failed",
      };
    }

    return {
      user,
      error: null,
    };
  } catch (error) {
    console.error("Authentication error:", error);
    return {
      user: null,
      error: "Authentication failed",
    };
  }
}
