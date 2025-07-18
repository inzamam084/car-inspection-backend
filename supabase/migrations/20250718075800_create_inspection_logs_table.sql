-- Create inspection_logs table for saving logs of the inspection
CREATE TABLE IF NOT EXISTS "public"."inspection_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "inspection_id" "uuid" NOT NULL,
    "step" "text" NOT NULL,
    "error_message" "text",
    "error_type" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);

-- Set table owner
ALTER TABLE "public"."inspection_logs" OWNER TO "postgres";

-- Add primary key constraint
ALTER TABLE ONLY "public"."inspection_logs"
    ADD CONSTRAINT "inspection_logs_pkey" PRIMARY KEY ("id");

-- Add foreign key constraint
ALTER TABLE ONLY "public"."inspection_logs"
    ADD CONSTRAINT "inspection_logs_inspection_id_fkey" 
    FOREIGN KEY ("inspection_id") 
    REFERENCES "public"."inspections"("id") 
    ON DELETE CASCADE;
