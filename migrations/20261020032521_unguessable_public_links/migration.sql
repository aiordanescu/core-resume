CREATE TABLE "username_redirect" (
	"username" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resume" ADD COLUMN "slug_chosen" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "username_redirect" ADD CONSTRAINT "username_redirect_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;