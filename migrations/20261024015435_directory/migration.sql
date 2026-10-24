CREATE TABLE "company" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"normalized_key" text NOT NULL,
	"website" text,
	"notes" text DEFAULT '' NOT NULL,
	"sources" jsonb DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"company_id" text,
	"name" text NOT NULL,
	"normalized_key" text NOT NULL,
	"position" text DEFAULT '' NOT NULL,
	"profile_links" text[] DEFAULT '{}'::text[] NOT NULL,
	"emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"phones" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"relationship" text DEFAULT '' NOT NULL,
	"looking_for_work" boolean DEFAULT false NOT NULL,
	"connected_on" date,
	"sources" jsonb DEFAULT '[]' NOT NULL,
	"last_imported_at" timestamp with time zone,
	"last_contacted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_employment" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"company_id" text,
	"company_name" text NOT NULL,
	"position" text DEFAULT '' NOT NULL,
	"started_on" date,
	"ended_on" date
);
--> statement-breakpoint
CREATE TABLE "contact_note" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"text" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "company_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "company_user_id_normalized_key_index" ON "company" ("user_id","normalized_key");--> statement-breakpoint
CREATE INDEX "contact_user_id_company_id_index" ON "contact" ("user_id","company_id");--> statement-breakpoint
CREATE INDEX "contact_user_id_normalized_key_index" ON "contact" ("user_id","normalized_key");--> statement-breakpoint
CREATE INDEX "contact_employment_user_id_contact_id_index" ON "contact_employment" ("user_id","contact_id");--> statement-breakpoint
CREATE INDEX "contact_note_user_id_contact_id_index" ON "contact_note" ("user_id","contact_id");--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_company_id_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_company_id_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "contact_employment" ADD CONSTRAINT "contact_employment_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "contact_employment" ADD CONSTRAINT "contact_employment_contact_id_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "contact_employment" ADD CONSTRAINT "contact_employment_company_id_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "contact_note" ADD CONSTRAINT "contact_note_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "contact_note" ADD CONSTRAINT "contact_note_contact_id_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE CASCADE;
--> statement-breakpoint
-- Conservative, account-scoped keys. Preserve spelling in the display name.
INSERT INTO company (id, user_id, name, normalized_key, sources)
SELECT 'co_' || md5(jsonb_build_array(user_id, lower(btrim(regexp_replace(company, '\s+', ' ', 'g'))))::text),
 user_id, min(btrim(regexp_replace(company, '\s+', ' ', 'g'))), lower(btrim(regexp_replace(company, '\s+', ' ', 'g'))),
 jsonb_agg(jsonb_build_object('kind', 'application', 'id', id))
FROM application GROUP BY user_id, lower(btrim(regexp_replace(company, '\s+', ' ', 'g')));
--> statement-breakpoint
UPDATE application a SET company_id = c.id FROM company c
WHERE c.user_id = a.user_id AND c.normalized_key = lower(btrim(regexp_replace(a.company, '\s+', ' ', 'g')));
--> statement-breakpoint
WITH people AS (
 SELECT a.user_id, a.company_id, p->>'name' AS name, p->>'role' AS position,
 p->>'email' AS email, p->>'phone' AS phone, NULL::text AS profile,
 jsonb_build_object('kind', 'application', 'id', a.id) AS source
 FROM application a CROSS JOIN LATERAL jsonb_array_elements(a.contacts) p
 UNION ALL
 SELECT a.user_id, a.company_id, p->>'name', '', NULL, NULL, p->>'profileUrl',
 jsonb_build_object('kind', 'interview', 'id', a.id || ':' || (e->>'id'))
 FROM application a CROSS JOIN LATERAL jsonb_array_elements(a.activity) e
 CROSS JOIN LATERAL jsonb_array_elements(coalesce(e->'participants', '[]'::jsonb)) p WHERE e->>'type' = 'interview'
)
INSERT INTO contact (id, user_id, company_id, name, normalized_key, position, emails, phones, profile_links, sources)
SELECT 'ct_' || md5(jsonb_build_array(user_id, company_id, lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))))::text),
 user_id, company_id, min(btrim(regexp_replace(name, '\s+', ' ', 'g'))), lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))),
 coalesce(max(nullif(position, '')), ''),
 coalesce(array_agg(DISTINCT email) FILTER (WHERE email IS NOT NULL AND email <> ''), '{}'::text[]),
 coalesce(array_agg(DISTINCT phone) FILTER (WHERE phone IS NOT NULL AND phone <> ''), '{}'::text[]),
 coalesce(array_agg(DISTINCT profile) FILTER (WHERE profile IS NOT NULL AND profile <> ''), '{}'::text[]),
 jsonb_agg(DISTINCT source)
FROM people WHERE btrim(coalesce(name, '')) <> ''
GROUP BY user_id, company_id, lower(btrim(regexp_replace(name, '\s+', ' ', 'g')));
--> statement-breakpoint
UPDATE application a SET contacts = coalesce((
 SELECT jsonb_agg(p || jsonb_build_object('contactId', c.id) ORDER BY ord)
 FROM jsonb_array_elements(a.contacts) WITH ORDINALITY AS person(p, ord)
 JOIN contact c ON c.user_id = a.user_id AND c.company_id = a.company_id
 AND c.normalized_key = lower(btrim(regexp_replace(p->>'name', '\s+', ' ', 'g')))
), '[]'::jsonb);
--> statement-breakpoint
UPDATE application a SET activity = coalesce((
 SELECT jsonb_agg(CASE WHEN e->>'type' <> 'interview' THEN e ELSE
 jsonb_set(e, '{participants}', coalesce((
  SELECT jsonb_agg(p || jsonb_build_object('contactId', c.id) ORDER BY person_ord)
  FROM jsonb_array_elements(coalesce(e->'participants', '[]'::jsonb)) WITH ORDINALITY AS person(p, person_ord)
  JOIN contact c ON c.user_id = a.user_id AND c.company_id = a.company_id
  AND c.normalized_key = lower(btrim(regexp_replace(p->>'name', '\s+', ' ', 'g')))
 ), '[]'::jsonb)) END ORDER BY ord)
 FROM jsonb_array_elements(a.activity) WITH ORDINALITY AS event(e, ord)
), '[]'::jsonb);
