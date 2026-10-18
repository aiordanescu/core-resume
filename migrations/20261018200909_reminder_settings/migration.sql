ALTER TABLE "user" ADD COLUMN "no_reply_days" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "interview_reminders" boolean DEFAULT true NOT NULL;