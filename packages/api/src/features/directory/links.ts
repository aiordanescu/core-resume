import type { DbOrTx } from "@reactive-resume/db/client";
import type { Contact, InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import * as schema from "@reactive-resume/db/schema";
import { interviewParticipantSchema } from "@reactive-resume/schema/applications/data";
import { directoryKey } from "@reactive-resume/schema/directory";

export async function lockDirectoryOwner(tx: DbOrTx, userId: string) {
	const [owner] = await tx
		.select({ id: schema.user.id })
		.from(schema.user)
		.where(eq(schema.user.id, userId))
		.for("no key update");
	if (!owner) throw new ORPCError("NOT_FOUND");
}

export async function ownedCompany(tx: DbOrTx, userId: string, id: string) {
	const [row] = await tx
		.select()
		.from(schema.company)
		.where(and(eq(schema.company.id, id), eq(schema.company.userId, userId)));
	if (!row) throw new ORPCError("NOT_FOUND", { message: "Company not found." });
	return row;
}

export async function ownedContact(tx: DbOrTx, userId: string, id: string) {
	const [row] = await tx
		.select()
		.from(schema.contact)
		.where(and(eq(schema.contact.id, id), eq(schema.contact.userId, userId)));
	if (!row) throw new ORPCError("NOT_FOUND", { message: "Contact not found." });
	return row;
}

export async function ensureCompany(tx: DbOrTx, userId: string, name: string) {
	const normalizedKey = directoryKey(name);
	const [existing] = await tx
		.select()
		.from(schema.company)
		.where(and(eq(schema.company.userId, userId), eq(schema.company.normalizedKey, normalizedKey)));
	if (existing) return existing;
	const [created] = await tx.insert(schema.company).values({ userId, name: name.trim(), normalizedKey }).returning();
	if (!created) throw new ORPCError("INTERNAL_SERVER_ERROR");
	return created;
}

type Application = typeof schema.application.$inferSelect;
type Person = typeof schema.contact.$inferSelect;

export function applicationContactSnapshot(link: Contact, person: Person): Contact {
	return {
		contactId: person.id,
		name: person.name,
		role: person.position,
		type: link.type,
		email: person.emails[0] ?? "",
		phone: person.phones[0] ?? "",
	};
}

function interviewContactSnapshot(link: InterviewTimelineEntry["participants"][number], person: Person) {
	const profileUrl = person.profileLinks.find(
		(url) => interviewParticipantSchema.safeParse({ name: person.name, profileUrl: url }).success,
	);
	return { contactId: person.id, name: person.name, role: link.role, ...(profileUrl ? { profileUrl } : {}) };
}

/** The legacy JSON fields remain wire-compatible snapshots; contactId is the contextual link. */
export async function linkApplicationDirectory(tx: DbOrTx, row: Application) {
	const company = row.companyId
		? await ownedCompany(tx, row.userId, row.companyId)
		: await ensureCompany(tx, row.userId, row.company);
	if (!company.sources.some((source) => source.kind === "application" && source.id === row.id))
		await tx
			.update(schema.company)
			.set({ sources: [...company.sources, { kind: "application", id: row.id }] })
			.where(eq(schema.company.id, company.id));
	const resolve = async (
		link: {
			contactId?: string | undefined;
			name: string;
			role?: string | undefined;
			email?: string | undefined;
			phone?: string | undefined;
			profileUrl?: string | undefined;
		},
		kind: "application" | "interview",
		sourceId: string,
	) => {
		if (link.contactId) return ownedContact(tx, row.userId, link.contactId);
		const [existing] = await tx
			.select()
			.from(schema.contact)
			.where(
				and(
					eq(schema.contact.userId, row.userId),
					eq(schema.contact.companyId, company.id),
					eq(schema.contact.normalizedKey, directoryKey(link.name)),
				),
			);
		const sources = [...(existing?.sources ?? [])];
		if (!sources.some((source) => source.kind === kind && source.id === sourceId)) sources.push({ kind, id: sourceId });
		const values = {
			position: existing?.position || (kind === "application" ? (link.role ?? "") : ""),
			emails: [...new Set([...(existing?.emails ?? []), ...(link.email ? [link.email] : [])])],
			phones: [...new Set([...(existing?.phones ?? []), ...(link.phone ? [link.phone] : [])])],
			profileLinks: [...new Set([...(existing?.profileLinks ?? []), ...(link.profileUrl ? [link.profileUrl] : [])])],
			sources,
		};
		const [saved] = existing
			? await tx.update(schema.contact).set(values).where(eq(schema.contact.id, existing.id)).returning()
			: await tx
					.insert(schema.contact)
					.values({
						...values,
						userId: row.userId,
						companyId: company.id,
						name: link.name,
						normalizedKey: directoryKey(link.name),
					})
					.returning();
		if (!saved) throw new ORPCError("INTERNAL_SERVER_ERROR");
		return saved;
	};
	const contacts: Contact[] = [];
	for (const link of row.contacts)
		contacts.push(applicationContactSnapshot(link, await resolve(link, "application", row.id)));
	const activity = [];
	for (const entry of row.activity) {
		if (entry.type !== "interview") {
			activity.push(entry);
			continue;
		}
		const participants: InterviewTimelineEntry["participants"] = [];
		for (const link of entry.participants ?? []) {
			const person = await resolve(link, "interview", `${row.id}:${entry.id}`);
			participants.push(interviewContactSnapshot(link, person));
		}
		activity.push({ ...entry, participants });
	}
	const [updated] = await tx
		.update(schema.application)
		.set({ companyId: company.id, company: company.name, contacts, activity, updatedAt: row.updatedAt })
		.where(and(eq(schema.application.id, row.id), eq(schema.application.userId, row.userId)))
		.returning();
	if (!updated) throw new ORPCError("NOT_FOUND");
	return updated;
}

/** Keep old clients' snapshots current; erasure removes the person from every contextual link. */
export async function refreshContactLinks(tx: DbOrTx, userId: string, id: string, person: Person | null) {
	const applications = await tx
		.select()
		.from(schema.application)
		.where(eq(schema.application.userId, userId))
		.orderBy(schema.application.id)
		.for("update");
	for (const row of applications) {
		const linked =
			row.contacts.some((link) => link.contactId === id) ||
			row.activity.some(
				(entry) => entry.type === "interview" && entry.participants?.some((link) => link.contactId === id),
			);
		if (!linked) continue;
		const contacts = row.contacts.flatMap((link) =>
			link.contactId !== id ? [link] : person ? [applicationContactSnapshot(link, person)] : [],
		);
		const activity = row.activity.map((entry) =>
			entry.type !== "interview"
				? entry
				: {
						...entry,
						participants: entry.participants.flatMap((link) =>
							link.contactId !== id ? [link] : person ? [interviewContactSnapshot(link, person)] : [],
						),
					},
		);
		await tx
			.update(schema.application)
			.set({ contacts, activity })
			.where(and(eq(schema.application.id, row.id), eq(schema.application.userId, userId)));
	}
}
