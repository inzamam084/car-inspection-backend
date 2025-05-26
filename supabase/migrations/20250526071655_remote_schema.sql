

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgjwt" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."handle_new_report"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$BEGIN
  -- Add error handling for the HTTP request
  BEGIN
    -- Call the edge function when a new report is created
    PERFORM
      net.http_post(
        url := 'https://hhymqgsreoqpoqdpefhe.supabase.co/functions/v1/run-inspection',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhoeW1xZ3NyZW9xcG9xZHBlZmhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY2ODU1MTIsImV4cCI6MjA2MjI2MTUxMn0.pcS49IJ2bLuyH_J1rkrf-0vRoCCycN0BhOdnnzlUOUw'
        ),
        body := jsonb_build_object(
          'inspection_id', NEW.inspection_id
        )
      );
  EXCEPTION
    WHEN OTHERS THEN
      -- Log the error and continue (prevents failed edge function calls from blocking database operations)
      INSERT INTO public.function_logs (function_name, error_message, record_id)
      VALUES ('handle_new_report', SQLERRM, NEW.id);
  END;
  
  RETURN NEW;
END;$$;


ALTER FUNCTION "public"."handle_new_report"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."function_logs" (
    "id" integer NOT NULL,
    "function_name" "text" NOT NULL,
    "error_message" "text" NOT NULL,
    "record_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."function_logs" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."function_logs_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE "public"."function_logs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."function_logs_id_seq" OWNED BY "public"."function_logs"."id";



CREATE TABLE IF NOT EXISTS "public"."inspections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "email" "text",
    "vin" "text",
    "mileage" "text",
    "zip" "text",
    "has_obd2_codes" boolean DEFAULT false,
    "has_title_images" boolean DEFAULT false
);


ALTER TABLE "public"."inspections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."obd2_codes" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "inspection_id" "uuid" NOT NULL,
    "code" character varying(10),
    "description" "text",
    "screenshot_path" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."obd2_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."photos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "inspection_id" "uuid",
    "category" "text",
    "path" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."photos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "inspection_id" "uuid",
    "summary" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "pdf_path" "text",
    "summary_json" "jsonb",
    "updated_at" "date",
    "cost" character varying(20),
    "ai_model" character varying(20),
    "total_tokens" character varying(20)
);


ALTER TABLE "public"."reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."title_images" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "inspection_id" "uuid" NOT NULL,
    "path" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."title_images" OWNER TO "postgres";


ALTER TABLE ONLY "public"."function_logs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."function_logs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."function_logs"
    ADD CONSTRAINT "function_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inspections"
    ADD CONSTRAINT "inspections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."obd2_codes"
    ADD CONSTRAINT "obd2_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."title_images"
    ADD CONSTRAINT "title_images_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_obd2_codes_inspection_id" ON "public"."obd2_codes" USING "btree" ("inspection_id");



CREATE INDEX "idx_title_images_inspection_id" ON "public"."title_images" USING "btree" ("inspection_id");



CREATE OR REPLACE TRIGGER "on_new_report" AFTER INSERT ON "public"."reports" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_report"();



ALTER TABLE ONLY "public"."inspections"
    ADD CONSTRAINT "inspections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."obd2_codes"
    ADD CONSTRAINT "obd2_codes_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."title_images"
    ADD CONSTRAINT "title_images_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE CASCADE;



CREATE POLICY "Allow anonymous insert" ON "public"."inspections" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow anonymous insert" ON "public"."photos" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow users to view photos for their inspections" ON "public"."photos" FOR SELECT USING (true);



CREATE POLICY "Allow users to view their own inspections" ON "public"."inspections" FOR SELECT USING (true);



CREATE POLICY "Users can insert photos for their inspections" ON "public"."photos" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."inspections"
  WHERE (("inspections"."id" = "photos"."inspection_id") AND ("inspections"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can insert their own inspections" ON "public"."inspections" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own inspections" ON "public"."inspections" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view photos of their inspections" ON "public"."photos" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."inspections"
  WHERE (("inspections"."id" = "photos"."inspection_id") AND ("inspections"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view reports of their inspections" ON "public"."reports" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."inspections"
  WHERE (("inspections"."id" = "reports"."inspection_id") AND ("inspections"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view their own inspections" ON "public"."inspections" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."inspections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."obd2_codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."photos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."title_images" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";














































































































































































GRANT ALL ON FUNCTION "public"."handle_new_report"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_report"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_report"() TO "service_role";


















GRANT ALL ON TABLE "public"."function_logs" TO "anon";
GRANT ALL ON TABLE "public"."function_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."function_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."function_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."function_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."function_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."inspections" TO "anon";
GRANT ALL ON TABLE "public"."inspections" TO "authenticated";
GRANT ALL ON TABLE "public"."inspections" TO "service_role";



GRANT ALL ON TABLE "public"."obd2_codes" TO "anon";
GRANT ALL ON TABLE "public"."obd2_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."obd2_codes" TO "service_role";



GRANT ALL ON TABLE "public"."photos" TO "anon";
GRANT ALL ON TABLE "public"."photos" TO "authenticated";
GRANT ALL ON TABLE "public"."photos" TO "service_role";



GRANT ALL ON TABLE "public"."reports" TO "anon";
GRANT ALL ON TABLE "public"."reports" TO "authenticated";
GRANT ALL ON TABLE "public"."reports" TO "service_role";



GRANT ALL ON TABLE "public"."title_images" TO "anon";
GRANT ALL ON TABLE "public"."title_images" TO "authenticated";
GRANT ALL ON TABLE "public"."title_images" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "service_role";






























RESET ALL;
