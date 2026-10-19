CREATE TABLE "career_fact_group" (
	"user_id" text,
	"group" text,
	"status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "career_fact_group_pkey" PRIMARY KEY("user_id","group")
);
--> statement-breakpoint
ALTER TABLE "career_fact" ADD COLUMN "group" text;--> statement-breakpoint
CREATE INDEX "career_fact_user_id_group_index" ON "career_fact" ("user_id","group");--> statement-breakpoint
ALTER TABLE "career_fact_group" ADD CONSTRAINT "career_fact_group_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;