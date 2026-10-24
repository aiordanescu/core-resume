import type { DirectorySource } from "@reactive-resume/schema/directory";
import * as pg from "drizzle-orm/pg-core";
import { generateId } from "@reactive-resume/utils/string";
import { user } from "./auth";

export const company = pg.pgTable(
	"company",
	{
		id: pg
			.text("id")
			.primaryKey()
			.$defaultFn(() => generateId()),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: pg.text("name").notNull(),
		normalizedKey: pg.text("normalized_key").notNull(),
		website: pg.text("website"),
		notes: pg.text("notes").notNull().default(""),
		sources: pg.jsonb("sources").$type<DirectorySource[]>().notNull().default([]),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: pg
			.timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(t) => [pg.uniqueIndex().on(t.userId, t.normalizedKey)],
);

export const contact = pg.pgTable(
	"contact",
	{
		id: pg
			.text("id")
			.primaryKey()
			.$defaultFn(() => generateId()),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		companyId: pg.text("company_id").references(() => company.id, { onDelete: "set null" }),
		name: pg.text("name").notNull(),
		normalizedKey: pg.text("normalized_key").notNull(),
		position: pg.text("position").notNull().default(""),
		profileLinks: pg.text("profile_links").array().notNull().default([]),
		emails: pg.text("emails").array().notNull().default([]),
		phones: pg.text("phones").array().notNull().default([]),
		notes: pg.text("notes").notNull().default(""),
		tags: pg.text("tags").array().notNull().default([]),
		relationship: pg.text("relationship").notNull().default(""),
		lookingForWork: pg.boolean("looking_for_work").notNull().default(false),
		connectedOn: pg.date("connected_on"),
		sources: pg.jsonb("sources").$type<DirectorySource[]>().notNull().default([]),
		lastImportedAt: pg.timestamp("last_imported_at", { withTimezone: true }),
		lastContactedAt: pg.timestamp("last_contacted_at", { withTimezone: true }),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: pg
			.timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(t) => [pg.index().on(t.userId, t.companyId), pg.index().on(t.userId, t.normalizedKey)],
);

export const contactEmployment = pg.pgTable(
	"contact_employment",
	{
		id: pg
			.text("id")
			.primaryKey()
			.$defaultFn(() => generateId()),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		contactId: pg
			.text("contact_id")
			.notNull()
			.references(() => contact.id, { onDelete: "cascade" }),
		companyId: pg.text("company_id").references(() => company.id, { onDelete: "set null" }),
		companyName: pg.text("company_name").notNull(),
		position: pg.text("position").notNull().default(""),
		startedOn: pg.date("started_on"),
		endedOn: pg.date("ended_on"),
	},
	(t) => [pg.index().on(t.userId, t.contactId)],
);

export const contactNote = pg.pgTable(
	"contact_note",
	{
		id: pg
			.text("id")
			.primaryKey()
			.$defaultFn(() => generateId()),
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		contactId: pg
			.text("contact_id")
			.notNull()
			.references(() => contact.id, { onDelete: "cascade" }),
		text: pg.text("text").notNull(),
		at: pg.timestamp("at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [pg.index().on(t.userId, t.contactId)],
);
