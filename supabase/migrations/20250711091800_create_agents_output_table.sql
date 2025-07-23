-- Create agents_output table to store output from 4 agents
CREATE TABLE IF NOT EXISTS "public"."agents_output" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "inspection_id" "uuid" NOT NULL,
    "image_processing" "jsonb",
    "market_value" "jsonb", 
    "expert_advice" "jsonb",
    "cost_forecasting" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);

-- Set table owner
ALTER TABLE "public"."agents_output" OWNER TO "postgres";

-- Add primary key constraint
ALTER TABLE ONLY "public"."agents_output"
    ADD CONSTRAINT "agents_output_pkey" PRIMARY KEY ("id");

-- Add foreign key constraint to reference inspections table
ALTER TABLE ONLY "public"."agents_output"
    ADD CONSTRAINT "agents_output_inspection_id_fkey" 
    FOREIGN KEY ("inspection_id") 
    REFERENCES "public"."inspections"("id") 
    ON DELETE CASCADE;

-- Create index for better query performance on inspection_id
CREATE INDEX "idx_agents_output_inspection_id" ON "public"."agents_output" USING "btree" ("inspection_id");

-- -- Enable Row Level Security
-- ALTER TABLE "public"."agents_output" ENABLE ROW LEVEL SECURITY;

-- -- Create RLS policy for users to view agents output for their inspections
-- CREATE POLICY "Users can view agents output for their inspections" 
-- ON "public"."agents_output" 
-- FOR SELECT 
-- USING ((EXISTS ( 
--     SELECT 1
--     FROM "public"."inspections"
--     WHERE (("inspections"."id" = "agents_output"."inspection_id") 
--            AND ("inspections"."user_id" = "auth"."uid"()))
-- )));

-- -- Create RLS policy for service role to have full access
-- CREATE POLICY "Allow service role full access" 
-- ON "public"."agents_output" 
-- FOR ALL 
-- USING (true);

-- Grant permissions to different roles
GRANT ALL ON TABLE "public"."agents_output" TO "anon";
GRANT ALL ON TABLE "public"."agents_output" TO "authenticated";
GRANT ALL ON TABLE "public"."agents_output" TO "service_role";

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at on row updates
CREATE TRIGGER "update_agents_output_updated_at" 
    BEFORE UPDATE ON "public"."agents_output" 
    FOR EACH ROW 
    EXECUTE FUNCTION "public"."update_updated_at_column"();
