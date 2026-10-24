import type { LinkedInImport } from "@reactive-resume/schema/directory-import";
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { directoryKey } from "@reactive-resume/schema/directory";
import {
	indexLinkedInContacts,
	matchLinkedInContact,
	updateLinkedInContactIndex,
} from "@reactive-resume/schema/directory-import";
import { ensureCompany, lockDirectoryOwner, ownedCompany, refreshContactLinks } from "./links";

const changedReview = () =>
	new ORPCError("CONFLICT", {
		message: "The Directory changed since this review. Refresh the review before importing again.",
	});
const unique = (values: string[]) => [...new Set(values)];

/** One reviewed batch is atomic. URL identity makes retries safe, including after a lost response. */
export function importLinkedInContacts(userId: string, input: LinkedInImport) {
	return db.transaction(async (tx) => {
		await lockDirectoryOwner(tx, userId);
		const contacts = await tx.select().from(schema.contact).where(eq(schema.contact.userId, userId));
		const contactIndex = indexLinkedInContacts(contacts);
		const original = new Map(contacts.map((contact) => [contact.id, contact]));
		const companyChoices = new Map<string, (typeof input.companies)[number]>();
		for (const choice of input.companies) {
			const key = directoryKey(choice.sourceName);
			if (companyChoices.has(key)) throw new ORPCError("BAD_REQUEST", { message: "Review each company name once." });
			if (choice.companyId) await ownedCompany(tx, userId, choice.companyId);
			companyChoices.set(key, choice);
		}
		const seen = new Set<string>();
		const updatedIds = new Set<string>();
		const result = { created: 0, updated: 0, unchanged: 0, skipped: 0, companiesCreated: 0 };
		const resolvedCompanies = new Map<string, string>();
		const now = new Date();
		for (const row of input.rows) {
			const connection = row.connection;
			if (seen.has(connection.profileUrl)) {
				result.skipped++;
				continue;
			}
			seen.add(connection.profileUrl);
			const match = matchLinkedInContact(connection, contactIndex);
			let current: typeof schema.contact.$inferSelect | undefined;
			if (row.action === "update") {
				current = original.get(row.contactId ?? "");
				if (!current) throw changedReview();
				if (!row.expectedUpdatedAt || current.updatedAt.getTime() !== row.expectedUpdatedAt.getTime())
					throw changedReview();
				if (updatedIds.has(current.id))
					throw new ORPCError("BAD_REQUEST", {
						message: "Choose only one imported profile for each existing contact.",
					});
				const matchedIds = match.candidates.map((candidate) => candidate.id);
				if (match.kind === "update" && match.contact?.id !== current.id) throw changedReview();
				if (match.kind !== "update" && (row.duplicateDecision !== "merge" || !matchedIds.includes(current.id)))
					throw changedReview();
				updatedIds.add(current.id);
			} else {
				// Never overwrite a person created by another import after this review, or by an earlier retry.
				if (match.kind === "update") {
					result.skipped++;
					continue;
				}
				if (match.kind === "duplicate" && (row.duplicateDecision !== "separate" || match.identities.length > 0))
					throw changedReview();
			}

			let companyId = current?.companyId ?? null;
			if (connection.company) {
				const key = directoryKey(connection.company);
				const resolved = resolvedCompanies.get(key);
				if (resolved) companyId = resolved;
				else {
					const choice = companyChoices.get(key);
					if (!choice)
						throw new ORPCError("BAD_REQUEST", { message: "Review the company for every selected connection." });
					const existing = choice.companyId
						? await ownedCompany(tx, userId, choice.companyId)
						: (
								await tx
									.select()
									.from(schema.company)
									.where(
										and(eq(schema.company.userId, userId), eq(schema.company.normalizedKey, directoryKey(choice.name))),
									)
							)[0];
					const company = existing ?? (await ensureCompany(tx, userId, choice.name));
					if (!existing) result.companiesCreated++;
					const sources = company.sources.some(
						(source) => source.kind === "linkedin" && directoryKey(source.id) === key,
					)
						? company.sources
						: [...company.sources, { kind: "linkedin" as const, id: choice.sourceName }];
					if (sources.length > 500)
						throw new ORPCError("BAD_REQUEST", {
							message: "This company has too many source aliases. Review its sources before importing.",
						});
					if (sources !== company.sources)
						await tx
							.update(schema.company)
							.set({ sources })
							.where(and(eq(schema.company.id, company.id), eq(schema.company.userId, userId)));
					companyId = company.id;
					resolvedCompanies.set(key, company.id);
				}
			}
			const sources = current?.sources.some(
				(source) => source.kind === "linkedin" && source.id === connection.profileUrl,
			)
				? current.sources
				: [...(current?.sources ?? []), { kind: "linkedin" as const, id: connection.profileUrl }];
			const fields = {
				name: connection.name,
				normalizedKey: directoryKey(connection.name),
				companyId,
				position: connection.position || current?.position || "",
				profileLinks: unique([...(current?.profileLinks ?? []), connection.profileUrl]),
				emails: unique([
					...(current?.emails ?? []),
					...(input.importEmails && connection.email ? [connection.email] : []),
				]),
				connectedOn: connection.connectedOn ?? current?.connectedOn ?? null,
				sources,
				lastImportedAt: now,
			};
			if (fields.profileLinks.length > 20 || fields.emails.length > 20 || sources.length > 500)
				throw new ORPCError("BAD_REQUEST", {
					message: `Too many profile links, email addresses, or sources for ${connection.name}. Edit this contact before importing.`,
				});
			if (current) {
				const { lastImportedAt: _importedAt, ...content } = fields;
				const changed = Object.entries(content).some(
					([key, value]) => JSON.stringify(current?.[key as keyof typeof current]) !== JSON.stringify(value),
				);
				if (current.companyId !== fields.companyId || current.position !== fields.position) {
					const previousCompany = current.companyId ? await ownedCompany(tx, userId, current.companyId) : null;
					if (previousCompany || current.position)
						await tx.insert(schema.contactEmployment).values({
							userId,
							contactId: current.id,
							companyId: current.companyId,
							companyName: previousCompany?.name ?? "",
							position: current.position,
						});
				}
				const [saved] = await tx
					.update(schema.contact)
					.set({ ...fields, updatedAt: changed ? now : current.updatedAt })
					.where(and(eq(schema.contact.id, current.id), eq(schema.contact.userId, userId)))
					.returning();
				if (!saved) throw changedReview();
				if (changed) {
					await refreshContactLinks(tx, userId, saved.id, saved);
					result.updated++;
				} else result.unchanged++;
				updateLinkedInContactIndex(contactIndex, saved, current);
			} else {
				const [saved] = await tx
					.insert(schema.contact)
					.values({ ...fields, userId })
					.returning();
				if (!saved) throw new ORPCError("INTERNAL_SERVER_ERROR");
				updateLinkedInContactIndex(contactIndex, saved);
				result.created++;
			}
		}
		return result;
	});
}
