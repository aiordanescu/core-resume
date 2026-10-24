import type { directoryDto } from "../../dto/directory";
import type z from "zod";
import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { directoryKey } from "@reactive-resume/schema/directory";
import { ensureCompany, lockDirectoryOwner, ownedCompany, ownedContact, refreshContactLinks } from "./links";

type Input<K extends keyof typeof directoryDto> = z.infer<(typeof directoryDto)[K]["input"]> & { userId: string };
const stripOwner = <T extends { userId: string }>(row: T) => {
	const { userId: _owner, ...rest } = row;
	return rest;
};
const literalLike = (value: string) => `%${value.replace(/[\\%_]/g, "\\$&")}%`;

export const directoryService = {
	companies: async ({ userId, query }: Input<"companies">) =>
		(
			await db
				.select()
				.from(schema.company)
				.where(
					and(eq(schema.company.userId, userId), query ? ilike(schema.company.name, literalLike(query)) : undefined),
				)
				.orderBy(asc(schema.company.name))
		).map(stripOwner),
	contacts: async ({ userId, query, companyId }: Input<"contacts">) =>
		(
			await db
				.select()
				.from(schema.contact)
				.where(
					and(
						eq(schema.contact.userId, userId),
						companyId ? eq(schema.contact.companyId, companyId) : undefined,
						query
							? or(ilike(schema.contact.name, literalLike(query)), ilike(schema.contact.position, literalLike(query)))
							: undefined,
					),
				)
				.orderBy(asc(schema.contact.name))
		).map(stripOwner),
	company: async ({ userId, id }: Input<"company">) => {
		const company = await ownedCompany(db, userId, id);
		const [contacts, applications] = await Promise.all([
			directoryService.contacts({ userId, companyId: id }),
			db
				.select({
					id: schema.application.id,
					company: schema.application.company,
					role: schema.application.role,
					status: schema.application.status,
					at: schema.application.appliedAt,
				})
				.from(schema.application)
				.where(and(eq(schema.application.userId, userId), eq(schema.application.companyId, id)))
				.orderBy(desc(schema.application.updatedAt)),
		]);
		return { company: stripOwner(company), contacts, applications };
	},
	createCompany: ({ userId, ...fields }: Input<"createCompany">) =>
		db.transaction(async (tx) => {
			await lockDirectoryOwner(tx, userId);
			const existing = await ensureCompany(tx, userId, fields.name);
			// Reusing a normalized name never overwrites an existing company's notes or website.
			if (existing.website || existing.notes || existing.sources.length) return stripOwner(existing);
			const [row] = await tx.update(schema.company).set(fields).where(eq(schema.company.id, existing.id)).returning();
			if (!row) throw new ORPCError("NOT_FOUND");
			return stripOwner(row);
		}),
	updateCompany: ({ userId, id, ...fields }: Input<"updateCompany">) =>
		db.transaction(async (tx) => {
			await lockDirectoryOwner(tx, userId);
			await ownedCompany(tx, userId, id);
			if (fields.name) {
				const matches = await tx
					.select()
					.from(schema.company)
					.where(and(eq(schema.company.userId, userId), eq(schema.company.normalizedKey, directoryKey(fields.name))));
				if (matches.some((row) => row.id !== id))
					throw new ORPCError("CONFLICT", { message: "A company with this name already exists." });
			}
			const [row] = await tx
				.update(schema.company)
				.set({ ...fields, ...(fields.name ? { normalizedKey: directoryKey(fields.name) } : {}) })
				.where(and(eq(schema.company.id, id), eq(schema.company.userId, userId)))
				.returning();
			if (!row) throw new ORPCError("NOT_FOUND");
			if (fields.name)
				await tx
					.update(schema.application)
					.set({ company: fields.name })
					.where(and(eq(schema.application.userId, userId), eq(schema.application.companyId, id)));
			return stripOwner(row);
		}),
	deleteCompany: ({ userId, id }: Input<"deleteCompany">) =>
		db.transaction(async (tx) => {
			await lockDirectoryOwner(tx, userId);
			await ownedCompany(tx, userId, id);
			await tx.delete(schema.company).where(and(eq(schema.company.id, id), eq(schema.company.userId, userId)));
		}),
	createContact: ({ userId, ...fields }: Input<"createContact">) =>
		db.transaction(async (tx) => {
			await lockDirectoryOwner(tx, userId);
			if (fields.companyId) await ownedCompany(tx, userId, fields.companyId);
			const [row] = await tx
				.insert(schema.contact)
				.values({ ...fields, userId, normalizedKey: directoryKey(fields.name) })
				.returning();
			if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
			return stripOwner(row);
		}),
	updateContact: ({ userId, id, ...fields }: Input<"updateContact">) =>
		db.transaction(async (tx) => {
			await lockDirectoryOwner(tx, userId);
			const current = await ownedContact(tx, userId, id);
			if (fields.companyId) await ownedCompany(tx, userId, fields.companyId);
			if (
				(fields.companyId !== undefined && fields.companyId !== current.companyId) ||
				(fields.position !== undefined && fields.position !== current.position)
			) {
				const company = current.companyId ? await ownedCompany(tx, userId, current.companyId) : null;
				if (company || current.position)
					await tx.insert(schema.contactEmployment).values({
						userId,
						contactId: id,
						companyId: current.companyId,
						companyName: company?.name ?? "",
						position: current.position,
					});
			}
			const [row] = await tx
				.update(schema.contact)
				.set({ ...fields, ...(fields.name ? { normalizedKey: directoryKey(fields.name) } : {}) })
				.where(and(eq(schema.contact.id, id), eq(schema.contact.userId, userId)))
				.returning();
			if (!row) throw new ORPCError("NOT_FOUND");
			await refreshContactLinks(tx, userId, id, row);
			return stripOwner(row);
		}),
	contact: async ({ userId, id }: Input<"contact">) => {
		const contact = await ownedContact(db, userId, id);
		const [company, employment, notes, rows] = await Promise.all([
			contact.companyId ? ownedCompany(db, userId, contact.companyId) : null,
			db
				.select()
				.from(schema.contactEmployment)
				.where(and(eq(schema.contactEmployment.userId, userId), eq(schema.contactEmployment.contactId, id))),
			db
				.select()
				.from(schema.contactNote)
				.where(and(eq(schema.contactNote.userId, userId), eq(schema.contactNote.contactId, id)))
				.orderBy(desc(schema.contactNote.at)),
			db
				.select()
				.from(schema.application)
				.where(eq(schema.application.userId, userId))
				.orderBy(desc(schema.application.updatedAt)),
		]);
		const summary = (row: typeof schema.application.$inferSelect) => ({
			id: row.id,
			company: row.company,
			role: row.role,
			status: row.status,
			at: row.appliedAt,
		});
		return {
			contact: stripOwner(contact),
			company: company ? stripOwner(company) : null,
			employment: employment.map(stripOwner),
			notes: notes.map(stripOwner),
			applications: rows.filter((row) => row.contacts.some((link) => link.contactId === id)).map(summary),
			interviews: rows.flatMap((row) =>
				row.activity.flatMap((entry) =>
					entry.type === "interview"
						? entry.participants
								.filter((link) => link.contactId === id)
								.map((link) => ({
									...summary(row),
									at: new Date(entry.at),
									entryId: entry.id,
									contextRole: link.role,
									kind: entry.kind,
								}))
						: [],
				),
			),
		};
	},
	deleteContact: ({ userId, id }: Input<"deleteContact">) =>
		db.transaction(async (tx) => {
			await lockDirectoryOwner(tx, userId);
			await ownedContact(tx, userId, id);
			await refreshContactLinks(tx, userId, id, null);
			await tx.delete(schema.contact).where(and(eq(schema.contact.id, id), eq(schema.contact.userId, userId)));
		}),
	deleteAllContacts: ({ userId }: Input<"deleteAllContacts">) =>
		db.transaction(async (tx) => {
			await lockDirectoryOwner(tx, userId);
			const rows = await tx
				.select()
				.from(schema.application)
				.where(eq(schema.application.userId, userId))
				.orderBy(schema.application.id)
				.for("update");
			for (const row of rows)
				await tx
					.update(schema.application)
					.set({
						contacts: [],
						activity: row.activity.map((entry) =>
							entry.type === "interview" ? { ...entry, participants: [] } : entry,
						),
					})
					.where(and(eq(schema.application.id, row.id), eq(schema.application.userId, userId)));
			await tx.delete(schema.contact).where(eq(schema.contact.userId, userId));
		}),
	addNote: ({ userId, id, text, at }: Input<"addNote">) =>
		db.transaction(async (tx) => {
			await lockDirectoryOwner(tx, userId);
			await ownedContact(tx, userId, id);
			const [row] = await tx
				.insert(schema.contactNote)
				.values({ userId, contactId: id, text, ...(at ? { at } : {}) })
				.returning();
			if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR");
			return stripOwner(row);
		}),
	deleteNote: ({ userId, id }: Input<"deleteNote">) =>
		db.transaction(async (tx) => {
			await lockDirectoryOwner(tx, userId);
			const rows = await tx
				.delete(schema.contactNote)
				.where(and(eq(schema.contactNote.id, id), eq(schema.contactNote.userId, userId)))
				.returning();
			if (!rows.length) throw new ORPCError("NOT_FOUND");
		}),
	exportData: async (userId: string) => {
		const [companies, contacts, employment, notes] = await Promise.all([
			db.select().from(schema.company).where(eq(schema.company.userId, userId)),
			db.select().from(schema.contact).where(eq(schema.contact.userId, userId)),
			db.select().from(schema.contactEmployment).where(eq(schema.contactEmployment.userId, userId)),
			db.select().from(schema.contactNote).where(eq(schema.contactNote.userId, userId)),
		]);
		return {
			companies: companies.map(stripOwner),
			contacts: contacts.map(stripOwner),
			employment: employment.map(stripOwner),
			notes: notes.map(stripOwner),
		};
	},
};
