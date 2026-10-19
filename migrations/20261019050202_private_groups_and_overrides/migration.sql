CREATE TABLE "career_fact_override" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"application_id" text NOT NULL,
	"group" text,
	"fact_id" text,
	"mode" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "career_fact_override_one_target" CHECK (("group" is null) <> ("fact_id" is null))
);
--> statement-breakpoint
ALTER TABLE "career_fact_group" ADD COLUMN "private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "career_fact_override_application_id_group_index" ON "career_fact_override" ("application_id","group");--> statement-breakpoint
CREATE UNIQUE INDEX "career_fact_override_application_id_fact_id_index" ON "career_fact_override" ("application_id","fact_id");--> statement-breakpoint
ALTER TABLE "career_fact_override" ADD CONSTRAINT "career_fact_override_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "career_fact_override" ADD CONSTRAINT "career_fact_override_application_id_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "application"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "career_fact_override" ADD CONSTRAINT "career_fact_override_fact_id_career_fact_id_fkey" FOREIGN KEY ("fact_id") REFERENCES "career_fact"("id") ON DELETE CASCADE;