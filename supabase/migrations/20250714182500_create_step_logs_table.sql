-- Create step_logs table for dynamic logging of multiple processing steps
CREATE TABLE IF NOT EXISTS "public"."step_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "inspection_id" "uuid" NOT NULL,
    "job_id" "uuid", -- Optional reference to processing_jobs table
    "step_name" "text" NOT NULL, -- e.g., 'image_analysis', 'market_research', 'expert_advice', 'cost_forecast'
    "step_type" "text" NOT NULL CHECK (step_type IN ('start', 'progress', 'success', 'error', 'warning', 'info')),
    "sequence_order" integer NOT NULL DEFAULT 0, -- Order within the inspection process
    "sub_step_order" integer DEFAULT 0, -- Order within a specific step (for multiple logs per step)
    "message" "text", -- Human-readable log message
    "details" "jsonb", -- Dynamic JSON data specific to each step
    "metadata" "jsonb", -- Additional metadata (timing, tokens used, costs, etc.)
    "error_code" "text", -- Standardized error codes if applicable
    "duration_ms" integer, -- Step execution time in milliseconds
    "tokens_used" integer, -- AI tokens consumed (if applicable)
    "cost_usd" decimal(10,6), -- Cost in USD (if applicable)
    "model_used" "text", -- AI model used (if applicable)
    "retry_count" integer DEFAULT 0, -- Number of retries for this step
    "parent_log_id" "uuid", -- Reference to parent log for hierarchical logging
    "tags" "text"[], -- Array of tags for categorization and filtering
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);

-- -- Set table owner
-- ALTER TABLE "public"."step_logs" OWNER TO "postgres";

-- -- Add primary key constraint
-- ALTER TABLE ONLY "public"."step_logs"
--     ADD CONSTRAINT "step_logs_pkey" PRIMARY KEY ("id");

-- -- Add foreign key constraints
-- ALTER TABLE ONLY "public"."step_logs"
--     ADD CONSTRAINT "step_logs_inspection_id_fkey" 
--     FOREIGN KEY ("inspection_id") 
--     REFERENCES "public"."inspections"("id") 
--     ON DELETE CASCADE;

-- ALTER TABLE ONLY "public"."step_logs"
--     ADD CONSTRAINT "step_logs_job_id_fkey" 
--     FOREIGN KEY ("job_id") 
--     REFERENCES "public"."processing_jobs"("id") 
--     ON DELETE SET NULL;

-- ALTER TABLE ONLY "public"."step_logs"
--     ADD CONSTRAINT "step_logs_parent_log_id_fkey" 
--     FOREIGN KEY ("parent_log_id") 
--     REFERENCES "public"."step_logs"("id") 
--     ON DELETE SET NULL;

-- -- Create indexes for efficient querying
-- CREATE INDEX "idx_step_logs_inspection_id" ON "public"."step_logs" USING "btree" ("inspection_id");
-- CREATE INDEX "idx_step_logs_job_id" ON "public"."step_logs" USING "btree" ("job_id");
-- CREATE INDEX "idx_step_logs_step_name" ON "public"."step_logs" USING "btree" ("step_name");
-- CREATE INDEX "idx_step_logs_step_type" ON "public"."step_logs" USING "btree" ("step_type");
-- CREATE INDEX "idx_step_logs_sequence" ON "public"."step_logs" USING "btree" ("inspection_id", "sequence_order", "sub_step_order");
-- CREATE INDEX "idx_step_logs_created_at" ON "public"."step_logs" USING "btree" ("created_at");
-- CREATE INDEX "idx_step_logs_tags" ON "public"."step_logs" USING "gin" ("tags");
-- CREATE INDEX "idx_step_logs_details" ON "public"."step_logs" USING "gin" ("details");

-- -- Create function to update updated_at timestamp
-- CREATE OR REPLACE FUNCTION "public"."update_step_logs_updated_at"()
-- RETURNS TRIGGER AS $$
-- BEGIN
--     NEW.updated_at = now();
--     RETURN NEW;
-- END;
-- $$ language 'plpgsql';

-- -- Create trigger to automatically update updated_at on row updates
-- CREATE TRIGGER "update_step_logs_updated_at" 
--     BEFORE UPDATE ON "public"."step_logs" 
--     FOR EACH ROW 
--     EXECUTE FUNCTION "public"."update_step_logs_updated_at"();

-- -- Create helper function to log steps with automatic sequencing
-- CREATE OR REPLACE FUNCTION "public"."log_step"(
--     p_inspection_id UUID,
--     p_job_id UUID DEFAULT NULL,
--     p_step_name TEXT,
--     p_step_type TEXT,
--     p_message TEXT DEFAULT NULL,
--     p_details JSONB DEFAULT NULL,
--     p_metadata JSONB DEFAULT NULL,
--     p_error_code TEXT DEFAULT NULL,
--     p_duration_ms INTEGER DEFAULT NULL,
--     p_tokens_used INTEGER DEFAULT NULL,
--     p_cost_usd DECIMAL DEFAULT NULL,
--     p_model_used TEXT DEFAULT NULL,
--     p_retry_count INTEGER DEFAULT 0,
--     p_parent_log_id UUID DEFAULT NULL,
--     p_tags TEXT[] DEFAULT NULL
-- )
-- RETURNS UUID AS $$
-- DECLARE
--     next_sequence INTEGER;
--     next_sub_step INTEGER;
--     log_id UUID;
-- BEGIN
--     -- Get next sequence order for this inspection
--     SELECT COALESCE(MAX(sequence_order), 0) + 1
--     INTO next_sequence
--     FROM step_logs
--     WHERE inspection_id = p_inspection_id;
    
--     -- If this is the same step name as the last log, increment sub_step_order
--     SELECT COALESCE(MAX(sub_step_order), 0) + 1
--     INTO next_sub_step
--     FROM step_logs
--     WHERE inspection_id = p_inspection_id 
--     AND step_name = p_step_name
--     AND sequence_order = (
--         SELECT MAX(sequence_order)
--         FROM step_logs
--         WHERE inspection_id = p_inspection_id
--         AND step_name = p_step_name
--     );
    
--     -- If no previous logs for this step, start sub_step at 0
--     IF next_sub_step IS NULL THEN
--         next_sub_step := 0;
--     END IF;
    
--     -- Insert the log entry
--     INSERT INTO step_logs (
--         inspection_id, job_id, step_name, step_type, sequence_order, sub_step_order,
--         message, details, metadata, error_code, duration_ms, tokens_used,
--         cost_usd, model_used, retry_count, parent_log_id, tags
--     ) VALUES (
--         p_inspection_id, p_job_id, p_step_name, p_step_type, next_sequence, next_sub_step,
--         p_message, p_details, p_metadata, p_error_code, p_duration_ms, p_tokens_used,
--         p_cost_usd, p_model_used, p_retry_count, p_parent_log_id, p_tags
--     ) RETURNING id INTO log_id;
    
--     RETURN log_id;
-- END;
-- $$ LANGUAGE plpgsql SECURITY DEFINER;

-- -- Create function to get logs summary for an inspection
-- CREATE OR REPLACE FUNCTION "public"."get_inspection_logs_summary"(p_inspection_id UUID)
-- RETURNS TABLE (
--     step_name TEXT,
--     total_logs BIGINT,
--     success_count BIGINT,
--     error_count BIGINT,
--     warning_count BIGINT,
--     total_duration_ms BIGINT,
--     total_tokens_used BIGINT,
--     total_cost_usd DECIMAL,
--     last_updated TIMESTAMP WITH TIME ZONE
-- ) AS $$
-- BEGIN
--     RETURN QUERY
--     SELECT 
--         sl.step_name,
--         COUNT(*) as total_logs,
--         COUNT(*) FILTER (WHERE sl.step_type = 'success') as success_count,
--         COUNT(*) FILTER (WHERE sl.step_type = 'error') as error_count,
--         COUNT(*) FILTER (WHERE sl.step_type = 'warning') as warning_count,
--         SUM(sl.duration_ms) as total_duration_ms,
--         SUM(sl.tokens_used) as total_tokens_used,
--         SUM(sl.cost_usd) as total_cost_usd,
--         MAX(sl.updated_at) as last_updated
--     FROM step_logs sl
--     WHERE sl.inspection_id = p_inspection_id
--     GROUP BY sl.step_name
--     ORDER BY MAX(sl.sequence_order);
-- END;
-- $$ LANGUAGE plpgsql SECURITY DEFINER;

-- -- Enable Row Level Security
-- ALTER TABLE "public"."step_logs" ENABLE ROW LEVEL SECURITY;

-- -- Create RLS policy for users to view step logs for their inspections
-- CREATE POLICY "Users can view step logs for their inspections" 
-- ON "public"."step_logs" 
-- FOR SELECT 
-- USING ((EXISTS ( 
--     SELECT 1
--     FROM "public"."inspections"
--     WHERE (("inspections"."id" = "step_logs"."inspection_id") 
--            AND ("inspections"."user_id" = "auth"."uid"()))
-- )));

-- -- Create RLS policy for service role to have full access
-- CREATE POLICY "Allow service role full access on step logs" 
-- ON "public"."step_logs" 
-- FOR ALL 
-- USING (true);

-- -- Grant permissions to different roles
-- GRANT ALL ON TABLE "public"."step_logs" TO "anon";
-- GRANT ALL ON TABLE "public"."step_logs" TO "authenticated";
-- GRANT ALL ON TABLE "public"."step_logs" TO "service_role";

-- -- Grant permissions for the helper functions
-- GRANT EXECUTE ON FUNCTION "public"."log_step" TO "anon";
-- GRANT EXECUTE ON FUNCTION "public"."log_step" TO "authenticated";
-- GRANT EXECUTE ON FUNCTION "public"."log_step" TO "service_role";

-- GRANT EXECUTE ON FUNCTION "public"."get_inspection_logs_summary" TO "anon";
-- GRANT EXECUTE ON FUNCTION "public"."get_inspection_logs_summary" TO "authenticated";
-- GRANT EXECUTE ON FUNCTION "public"."get_inspection_logs_summary" TO "service_role";

-- -- Insert some example usage comments
-- COMMENT ON TABLE "public"."step_logs" IS 'Dynamic logging table for multi-step processing with flexible JSON schema';
-- COMMENT ON COLUMN "public"."step_logs"."details" IS 'Step-specific data in JSON format - schema varies by step_name';
-- COMMENT ON COLUMN "public"."step_logs"."metadata" IS 'Additional metadata like timing, performance metrics, configuration';
-- COMMENT ON COLUMN "public"."step_logs"."tags" IS 'Array of tags for categorization and filtering (e.g., [''critical'', ''performance'', ''ai-model''])';
-- COMMENT ON FUNCTION "public"."log_step" IS 'Helper function to insert step logs with automatic sequencing';
-- COMMENT ON FUNCTION "public"."get_inspection_logs_summary" IS 'Get aggregated summary of logs for an inspection';
