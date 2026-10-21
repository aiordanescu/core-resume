import type { AccountImportResult } from "../../dto/account-import";
import type { accountImportDto } from "../../dto/account-import";
import type { IdKind, IdMaps } from "./remap";
import type { DbOrTx } from "@reactive-resume/db/client";
import type { PgTable } from "drizzle-orm/pg-core";
import type z from "zod";
import { and, count, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { aiLimitsSchema, careerProfileDataSchema } from "@reactive-resume/schema/career";
import { coverLetterSchema } from "@reactive-resume/schema/cover-letter/data";
import { noReplyDaysSchema } from "@reactive-resume/utils/reminders";
import { resumePagesSchema } from "@reactive-resume/utils/resume-pages";
import { generateId } from "@reactive-resume/utils/string";
import { careerService } from "../career/service";
import { sanitizeCoverLetterHtml } from "../cover-letters/html";
import { writeLetterVersion } from "../cover-letters/versions";
import { lockDocumentOwner } from "../documents/ownership";
import { parseWritableResumeData } from "../resume/resume-data-validation";
import { findFreeRandomSlug, findFreeSlug, SLUG_PATTERN } from "../resume/slugs";
import { writeVersion } from "../resume/version-history";
import { getStorageService } from "../storage/service";
import * as records from "./records";
import { flattenIds, mapIdList, remapIds } from "./remap";

type Input = z.infer<typeof accountImportDto.run.input>;
type AreaInput<A extends Input["area"]> = Extract<Input, { area: A }>;
type Reason = AccountImportResult["skipped"][number]["reason"];

// Inserts go in batches; a statement carries at most 65,535 parameters.
const BATCH = 200;

const chunks = <T>(list: readonly T[], size = BATCH) =>
	Array.from({ length: Math.ceil(list.length / size) }, (_, index) => list.slice(index * size, (index + 1) * size));

/** What one area added and skipped, plus the new ids later areas need. */
class Report {
	ids: IdMaps = {};
	added: Record<string, number> = {};
	skipped = new Map<string, number>();
	madePrivate = 0;

	add(kind: string, amount = 1) {
		if (amount > 0) this.added[kind] = (this.added[kind] ?? 0) + amount;
	}

	skip(kind: string, reason: Reason, amount = 1) {
		if (amount > 0) this.skipped.set(`${kind}:${reason}`, (this.skipped.get(`${kind}:${reason}`) ?? 0) + amount);
	}

	map(kind: IdKind, from: string, to: string) {
		(this.ids[kind] ??= {})[from] = to;
	}

	result(): AccountImportResult {
		return {
			ids: this.ids,
			added: this.added,
			skipped: [...this.skipped].map(([key, amount]) => {
				const [kind = "", reason] = key.split(":");
				return { kind, reason: reason as Reason, count: amount };
			}),
			madePrivate: this.madePrivate,
		};
	}
}

/** Parses each record, counting the ones that can't be read. */
function readAll<S extends z.ZodType>(report: Report, kind: string, schemaFor: S, list: readonly unknown[]) {
	const read: z.infer<S>[] = [];
	for (const item of list) {
		const parsed = schemaFor.safeParse(item);
		if (parsed.success) read.push(parsed.data);
		else report.skip(kind, "unreadable");
	}
	return read;
}

const OWNED = {
	resume: { table: schema.resume, id: schema.resume.id, userId: schema.resume.userId },
	letter: { table: schema.coverLetter, id: schema.coverLetter.id, userId: schema.coverLetter.userId },
	application: { table: schema.application, id: schema.application.id, userId: schema.application.userId },
	fact: { table: schema.careerFact, id: schema.careerFact.id, userId: schema.careerFact.userId },
	story: { table: schema.careerStory, id: schema.careerStory.id, userId: schema.careerStory.userId },
	artifact: { table: schema.careerArtifact, id: schema.careerArtifact.id, userId: schema.careerArtifact.userId },
	schedule: { table: schema.careerSchedule, id: schema.careerSchedule.id, userId: schema.careerSchedule.userId },
	thread: { table: schema.agentThread, id: schema.agentThread.id, userId: schema.agentThread.userId },
} as const;

/**
 * The id maps an earlier area returned, keeping only new ids this user owns: the client sends them back, so a map
 * must never let an import point at someone else's records.
 */
async function verifiedIds(client: DbOrTx, userId: string, ids: IdMaps, kinds: readonly IdKind[]) {
	const verified: IdMaps = {};
	for (const kind of kinds) {
		const entries = Object.entries(ids[kind] ?? {});
		if (entries.length === 0) continue;
		const owned = new Set<string>();
		const { table, id, userId: owner } = OWNED[kind];
		const candidates = entries.map(([, to]) => to);
		for (const part of chunks(candidates, 5000)) {
			const rows = await client
				.select({ id })
				.from(table as PgTable)
				.where(and(eq(owner, userId), inArray(id, part)));
			for (const row of rows) owned.add(row.id);
		}
		verified[kind] = Object.fromEntries(entries.filter(([, to]) => owned.has(to)));
	}
	return verified;
}

/**
 * Drops fields the file didn't have, so the database fills in its defaults. Imported times are kept where the file had
 * them, which also keeps stories valid: a story is dropped when a fact behind it looks newer than the story.
 */
function defined<T extends Record<string, unknown>>(value: T) {
	return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as {
		[K in keyof T]: Exclude<T[K], undefined>;
	};
}

async function readResumeData(data: unknown) {
	const { parseReactiveResumeJSON } = await import("@reactive-resume/import/reactive-resume-json");
	const parsed = parseReactiveResumeJSON(JSON.stringify(data));
	const { convertLegacyStylesheet, needsLegacyStyleConversion } = await import("@reactive-resume/pdf/semantic-legacy");
	if (needsLegacyStyleConversion(parsed.metadata)) parsed.metadata.stylesheet = convertLegacyStylesheet(parsed);
	return parseWritableResumeData(parsed);
}

async function importDocuments(userId: string, input: AreaInput<"documents">) {
	const report = new Report();
	const resumes = readAll(report, "resumes", records.resumeRecord, input.resumes);
	const letters = readAll(report, "letters", records.letterRecord, input.letters);
	const prepared: Array<{ resume: (typeof resumes)[number]; data: Awaited<ReturnType<typeof readResumeData>> }> = [];
	for (const resume of resumes) {
		try {
			prepared.push({ resume, data: await readResumeData(resume.data) });
		} catch {
			report.skip("resumes", "unreadable");
		}
	}

	let removed: string[] = [];
	await db.transaction(async (tx) => {
		await lockDocumentOwner(tx, userId);
		if (input.mode === "replace") {
			removed = (
				await tx.delete(schema.resume).where(eq(schema.resume.userId, userId)).returning({ id: schema.resume.id })
			).map((row) => row.id);
			await tx.delete(schema.coverLetter).where(eq(schema.coverLetter.userId, userId));
		}

		for (const { resume, data } of prepared) {
			const id = generateId();
			const chosen = resume.slugChosen && SLUG_PATTERN.test(resume.slug);
			const slug = chosen ? await findFreeSlug(tx, userId, resume.slug) : await findFreeRandomSlug(tx, userId);
			const name = resume.name || data.basics.name.trim().slice(0, 100) || "Imported resume";
			await tx.insert(schema.resume).values(
				defined({
					id,
					userId,
					name,
					slug,
					slugChosen: chosen,
					tags: resume.tags,
					// Nothing goes public by surprise: the report lists these so they can be shared again.
					isPublic: false,
					showDownloadButtons: resume.showDownloadButtons,
					isLocked: resume.isLocked,
					data,
					createdAt: resume.createdAt,
					updatedAt: resume.updatedAt,
				}),
			);
			await writeVersion(tx, { resumeId: id, userId, data, kind: "import" });
			if (resume.isPublic) report.madePrivate++;
			report.map("resume", resume.id, id);
			report.add("resumes");
		}

		const resumeIds = flattenIds({ resume: report.ids.resume ?? {} });
		for (const letter of letters) {
			const sourceResumeId = letter.sourceResumeId ? (resumeIds.get(letter.sourceResumeId) ?? null) : null;
			const [row] = await tx
				.insert(schema.coverLetter)
				.values(
					defined({
						userId,
						name: letter.name,
						recipient: sanitizeCoverLetterHtml(letter.recipient),
						content: sanitizeCoverLetterHtml(letter.content),
						greeting: letter.greeting,
						signOff: letter.signOff,
						style: letter.style,
						layout: letter.layout,
						recipientName: letter.recipientName,
						recipientCompany: letter.recipientCompany,
						letterDate: letter.letterDate,
						sourceResumeId,
						// Linked to its application once Applications are in (see importApplications).
						sourceApplicationId: null,
						senderLinked: sourceResumeId ? letter.senderLinked : false,
						designLinked: sourceResumeId ? letter.designLinked : false,
						tags: letter.tags,
						isLocked: letter.isLocked,
						createdAt: letter.createdAt,
						updatedAt: letter.updatedAt,
					}),
				)
				.returning();
			if (!row) continue;
			await writeLetterVersion(tx, { letter: coverLetterSchema.parse(row), userId, kind: "created" });
			report.map("letter", letter.id, row.id);
			report.add("letters");
		}
	});

	// Like a resume delete: generated files go once the rows are gone (best effort).
	if (removed.length > 0) {
		const storage = getStorageService();
		await Promise.allSettled(
			removed.flatMap((id) => [
				storage.delete(`uploads/${userId}/screenshots/${id}`),
				storage.delete(`uploads/${userId}/pdfs/${id}`),
			]),
		);
	}
	return report.result();
}

async function importApplications(userId: string, input: AreaInput<"applications">) {
	const report = new Report();
	const applications = readAll(report, "applications", records.applicationRecord, input.applications);
	const workspaces = readAll(report, "workspaces", records.workspaceRecord, input.workspaces);
	const letterLinks = readAll(report, "letterLinks", records.letterLink, input.letterLinks);

	await db.transaction(async (tx) => {
		await lockDocumentOwner(tx, userId);
		// Everything tied to an application goes with it (facts, stories, saved items, conversations...).
		if (input.mode === "replace") await tx.delete(schema.application).where(eq(schema.application.userId, userId));

		const known = flattenIds(await verifiedIds(tx, userId, input.ids, ["resume", "letter"]));
		const rows = applications.map(({ id: oldId, resumeId, coverLetterId, ...application }) => {
			const id = generateId();
			report.map("application", oldId, id);
			return defined({
				...application,
				id,
				userId,
				resumeId: resumeId ? (known.get(resumeId) ?? null) : null,
				coverLetterId: coverLetterId ? (known.get(coverLetterId) ?? null) : null,
				// Sent versions aren't in the export, so nothing points at one.
				sentResumeVersionId: null,
				sentCoverLetterVersionId: null,
			});
		});
		for (const part of chunks(rows)) await tx.insert(schema.application).values(part);
		report.add("applications", rows.length);

		const applicationIds = flattenIds({ application: report.ids.application ?? {} });
		const workspaceRows = workspaces.flatMap((workspace) => {
			const applicationId = applicationIds.get(workspace.applicationId);
			if (!applicationId) {
				report.skip("workspaces", "unlinked");
				return [];
			}
			// Facts and saved items it names are rewritten when Knowledge comes in.
			return [defined({ applicationId, userId, data: workspace.data, updatedAt: workspace.updatedAt })];
		});
		for (const part of chunks(workspaceRows)) await tx.insert(schema.careerWorkspace).values(part);
		report.add("workspaces", workspaceRows.length);

		for (const link of letterLinks) {
			const letterId = known.get(link.letterId);
			const applicationId = applicationIds.get(link.applicationId);
			if (!letterId || !applicationId) continue;
			await tx
				.update(schema.coverLetter)
				.set({ sourceApplicationId: applicationId })
				.where(and(eq(schema.coverLetter.id, letterId), eq(schema.coverLetter.userId, userId)));
		}
	});
	return report.result();
}

async function importKnowledge(userId: string, input: AreaInput<"knowledge">) {
	const report = new Report();
	const facts = readAll(report, "facts", records.factRecord, input.facts);
	const groups = readAll(report, "groups", records.factGroupRecord, input.groups);
	const overrides = readAll(report, "overrides", records.factOverrideRecord, input.overrides);
	const stories = readAll(report, "stories", records.storyRecord, input.stories);
	const artifacts = readAll(report, "artifacts", records.artifactRecord, input.artifacts);

	await db.transaction(async (tx) => {
		await lockDocumentOwner(tx, userId);
		if (input.mode === "replace") {
			for (const table of [
				schema.careerArtifact,
				schema.careerStory,
				schema.careerFactOverride,
				schema.careerFactGroup,
				schema.careerFact,
				schema.careerReview,
			]) {
				await tx.delete(table).where(eq(table.userId, userId));
			}
		}

		const verified = await verifiedIds(tx, userId, input.ids, ["resume", "letter", "application"]);
		const applications = flattenIds({ application: verified.application ?? {} });
		const documents = flattenIds({ resume: verified.resume ?? {}, letter: verified.letter ?? {} });
		/** The new application, null for a shared record, or undefined when its application wasn't imported. */
		const scope = (kind: string, applicationId: string | null) => {
			if (!applicationId) return null;
			const mapped = applications.get(applicationId);
			if (!mapped) report.skip(kind, "unlinked");
			return mapped;
		};

		// Facts: one the account already has (same source and quote) is skipped, and records that named it use the
		// existing one.
		const factRows = facts.flatMap(({ id: oldId, applicationId, source, ...fact }) => {
			const scoped = scope("facts", applicationId);
			if (scoped === undefined) return [];
			const sourceId = source.kind === "resume" || source.kind === "letter" ? documents.get(source.id) : undefined;
			return [
				{
					oldId,
					row: defined({
						...fact,
						id: generateId(),
						userId,
						applicationId: scoped,
						source: sourceId ? { ...source, id: sourceId } : source,
					}),
				},
			];
		});
		for (const part of chunks(factRows)) {
			const inserted = new Set(
				(
					await tx
						.insert(schema.careerFact)
						.values(part.map(({ row }) => row))
						.onConflictDoNothing()
						.returning({ id: schema.careerFact.id })
				).map((row) => row.id),
			);
			const existing = part.filter(({ row }) => !inserted.has(row.id));
			const bySourceKey = new Map<string, string>();
			if (existing.length > 0) {
				const rows = await tx
					.select({ id: schema.careerFact.id, sourceKey: schema.careerFact.sourceKey })
					.from(schema.careerFact)
					.where(
						and(
							eq(schema.careerFact.userId, userId),
							inArray(
								schema.careerFact.sourceKey,
								existing.map(({ row }) => row.sourceKey),
							),
						),
					);
				for (const row of rows) bySourceKey.set(row.sourceKey, row.id);
			}
			for (const { oldId, row } of part) {
				const id = inserted.has(row.id) ? row.id : bySourceKey.get(row.sourceKey);
				if (id) report.map("fact", oldId, id);
			}
			report.add("facts", inserted.size);
			report.skip("facts", "exists", part.length - inserted.size);
		}

		// Groups merge by path: a group the account already has keeps its own settings.
		for (const part of chunks(groups)) {
			const added = await tx
				.insert(schema.careerFactGroup)
				.values(part.map((group) => defined({ ...group, userId })))
				.onConflictDoNothing()
				.returning({ group: schema.careerFactGroup.group });
			report.add("groups", added.length);
			report.skip("groups", "exists", part.length - added.length);
		}

		const factIds = flattenIds({ fact: report.ids.fact ?? {} });
		const overrideRows = overrides.flatMap((override) => {
			const applicationId = applications.get(override.applicationId);
			const factId = override.factId ? factIds.get(override.factId) : null;
			if (!applicationId || factId === undefined || (factId === null) === (override.group === null)) {
				report.skip("overrides", "unlinked");
				return [];
			}
			return [
				defined({
					userId,
					applicationId,
					factId,
					group: factId ? null : override.group,
					mode: override.mode,
					createdAt: override.createdAt,
				}),
			];
		});
		for (const part of chunks(overrideRows)) {
			const added = await tx.insert(schema.careerFactOverride).values(part).onConflictDoNothing().returning({
				id: schema.careerFactOverride.id,
			});
			report.add("overrides", added.length);
			report.skip("overrides", "exists", part.length - added.length);
		}

		const storyRows = stories.flatMap(({ id: oldId, applicationId, data, ...story }) => {
			const scoped = scope("stories", applicationId);
			if (scoped === undefined) return [];
			const id = generateId();
			report.map("story", oldId, id);
			return [
				defined({
					...story,
					id,
					userId,
					applicationId: scoped,
					data: { ...data, applicationId: scoped, factIds: mapIdList(data.factIds, factIds) },
				}),
			];
		});
		for (const part of chunks(storyRows)) await tx.insert(schema.careerStory).values(part);
		report.add("stories", storyRows.length);

		const linked = flattenIds({ fact: report.ids.fact ?? {}, story: report.ids.story ?? {} });
		const artifactRows = artifacts.flatMap(({ id: oldId, applicationId, data, evidence, ...artifact }) => {
			const scoped = scope("artifacts", applicationId);
			if (scoped === undefined) return [];
			const id = generateId();
			report.map("artifact", oldId, id);
			return [
				defined({
					...artifact,
					id,
					userId,
					applicationId: scoped,
					data: remapIds(data, linked),
					evidence: { factIds: mapIdList(evidence.factIds, linked), storyIds: mapIdList(evidence.storyIds, linked) },
					// Its scheduled job isn't imported.
					jobId: null,
				}),
			];
		});
		for (const part of chunks(artifactRows)) await tx.insert(schema.careerArtifact).values(part);
		report.add("artifacts", artifactRows.length);

		// The imported applications' workspaces name facts and saved items by their old ids.
		const newApplications = [...applications.values()];
		if (newApplications.length > 0 && (factIds.size > 0 || artifactRows.length > 0)) {
			const all = flattenIds({ ...report.ids });
			const rows = await tx
				.select()
				.from(schema.careerWorkspace)
				.where(
					and(
						eq(schema.careerWorkspace.userId, userId),
						inArray(schema.careerWorkspace.applicationId, newApplications),
					),
				);
			for (const row of rows) {
				await tx
					.update(schema.careerWorkspace)
					.set({ data: remapIds(row.data, all) })
					.where(eq(schema.careerWorkspace.applicationId, row.applicationId));
			}
		}
	});
	return report.result();
}

async function importJobSearch(userId: string, input: AreaInput<"jobSearch">) {
	const report = new Report();
	const opportunities = readAll(report, "opportunities", records.opportunityRecord, input.opportunities);
	const schedules = readAll(report, "schedules", records.scheduleRecord, input.schedules);

	await db.transaction(async (tx) => {
		await lockDocumentOwner(tx, userId);
		if (input.mode === "replace") {
			await tx.delete(schema.careerOpportunity).where(eq(schema.careerOpportunity.userId, userId));
			await tx.delete(schema.careerSchedule).where(eq(schema.careerSchedule.userId, userId));
		}
		const applications = flattenIds(await verifiedIds(tx, userId, input.ids, ["application"]));

		// A posting the account already found is skipped (one per address).
		for (const part of chunks(opportunities)) {
			const added = await tx
				.insert(schema.careerOpportunity)
				.values(
					part.map(({ trackedApplicationId, ...opportunity }) =>
						defined({
							...opportunity,
							userId,
							trackedApplicationId: trackedApplicationId ? (applications.get(trackedApplicationId) ?? null) : null,
						}),
					),
				)
				.onConflictDoNothing()
				.returning({ id: schema.careerOpportunity.id });
			report.add("opportunities", added.length);
			report.skip("opportunities", "exists", part.length - added.length);
		}

		// Switched off, so an import never starts AI work by itself; the user turns them back on.
		const scheduleRows = schedules.flatMap(({ id: oldId, applicationId, ...schedule }) => {
			const mapped = applicationId ? applications.get(applicationId) : null;
			if (mapped === undefined) {
				report.skip("schedules", "unlinked");
				return [];
			}
			const id = generateId();
			report.map("schedule", oldId, id);
			return [defined({ ...schedule, id, userId, applicationId: mapped, enabled: false, aiProviderId: null })];
		});
		for (const part of chunks(scheduleRows)) await tx.insert(schema.careerSchedule).values(part);
		report.add("schedules", scheduleRows.length);
	});
	return report.result();
}

async function importCoach(userId: string, input: AreaInput<"coach">) {
	const report = new Report();
	const threads = readAll(report, "threads", records.threadRecord, input.threads);
	const messages = readAll(report, "messages", records.messageRecord, input.messages);
	const transcripts = readAll(report, "transcripts", records.transcriptRecord, input.transcripts);

	let removed: string[] = [];
	await db.transaction(async (tx) => {
		await lockDocumentOwner(tx, userId);
		if (input.mode === "replace") {
			// Deleted the way Coach deletes a conversation: marked deleted, its attachments removed.
			removed = (
				await tx
					.update(schema.agentThread)
					.set({ status: "deleted", deletedAt: new Date() })
					.where(and(eq(schema.agentThread.userId, userId), isNull(schema.agentThread.deletedAt)))
					.returning({ id: schema.agentThread.id })
			).map((row) => row.id);
			await tx.delete(schema.agentAttachment).where(eq(schema.agentAttachment.userId, userId));
			await tx.delete(schema.careerTranscript).where(eq(schema.careerTranscript.userId, userId));
		}
		const known = flattenIds(await verifiedIds(tx, userId, input.ids, ["resume", "letter", "application"]));
		const relink = (value: string | null) => (value ? (known.get(value) ?? null) : null);

		const threadRows = threads.flatMap(({ id: oldId, applicationId, ...thread }) => {
			if (thread.deletedAt || thread.status === "deleted") return [];
			const mapped = applicationId ? known.get(applicationId) : null;
			if (mapped === undefined) {
				report.skip("threads", "unlinked");
				return [];
			}
			const id = generateId();
			report.map("thread", oldId, id);
			return [
				defined({
					...thread,
					id,
					userId,
					applicationId: mapped,
					sourceResumeId: relink(thread.sourceResumeId),
					workingResumeId: relink(thread.workingResumeId),
					coverLetterId: relink(thread.coverLetterId),
					// Conversations continue with the account's own provider.
					aiProviderId: null,
				}),
			];
		});
		for (const part of chunks(threadRows)) await tx.insert(schema.agentThread).values(part);
		report.add("threads", threadRows.length);

		const threadIds = flattenIds({ thread: report.ids.thread ?? {} });
		const messageRows = messages.flatMap(({ threadId, ...message }) => {
			const mapped = threadIds.get(threadId);
			if (!mapped) return [];
			// A reply that was still being written when the export was taken can't resume here.
			const status = message.status === "completed" || message.status === "error" ? message.status : "completed";
			return [defined({ ...message, status, threadId: mapped, userId })];
		});
		for (const part of chunks(messageRows, 100)) await tx.insert(schema.agentMessage).values(part);
		report.add("messages", messageRows.length);

		const transcriptRows = transcripts.flatMap(({ applicationId, ...transcript }) => {
			const mapped = applicationId ? known.get(applicationId) : null;
			if (mapped === undefined) {
				report.skip("transcripts", "unlinked");
				return [];
			}
			return [defined({ ...transcript, userId, applicationId: mapped })];
		});
		for (const part of chunks(transcriptRows)) await tx.insert(schema.careerTranscript).values(part);
		report.add("transcripts", transcriptRows.length);
	});

	if (removed.length > 0) {
		const storage = getStorageService();
		await Promise.allSettled(removed.map((id) => storage.delete(`uploads/${userId}/agent/${id}`)));
	}
	return report.result();
}

async function importSettings(userId: string, input: AreaInput<"settings">) {
	const report = new Report();
	if (input.preferences) {
		const pages = resumePagesSchema.safeParse(input.preferences.resumePages);
		const days = noReplyDaysSchema.safeParse(input.preferences.noReplyDays);
		const reminders = input.preferences.interviewReminders;
		const changes = {
			...(pages.success ? { resumePages: pages.data } : {}),
			...(days.success ? { noReplyDays: days.data } : {}),
			...(typeof reminders === "boolean" ? { interviewReminders: reminders } : {}),
		};
		if (Object.keys(changes).length > 0) {
			await db.update(schema.user).set(changes).where(eq(schema.user.id, userId));
			report.add("preferences");
		} else report.skip("preferences", "unreadable");
	}
	if (input.aiLimits) {
		const limits = aiLimitsSchema.partial().safeParse(input.aiLimits);
		if (limits.success) {
			await careerService.saveAiLimits(userId, aiLimitsSchema.parse(limits.data));
			report.add("aiLimits");
		} else report.skip("aiLimits", "unreadable");
	}
	if (input.profile) {
		const profile = careerProfileDataSchema.safeParse(input.profile);
		if (profile.success) {
			await careerService.saveProfile(userId, profile.data);
			report.add("profile");
		} else report.skip("profile", "unreadable");
	}
	return report.result();
}

const total = (rows: Array<{ value: number }>) => rows[0]?.value ?? 0;

export const accountImportService = {
	/** What the account has now, for the confirmation before an area is replaced. */
	preview: async (userId: string): Promise<z.infer<typeof accountImportDto.preview.output>> => {
		const owned = (column: Parameters<typeof eq>[0]) => eq(column, userId);
		const [resumes, locked, letters, applications, facts, scopedFacts, stories, scopedStories, groups] =
			await Promise.all([
				db.select({ value: count() }).from(schema.resume).where(owned(schema.resume.userId)),
				db
					.select({ value: count() })
					.from(schema.resume)
					.where(and(owned(schema.resume.userId), eq(schema.resume.isLocked, true))),
				db.select({ value: count() }).from(schema.coverLetter).where(owned(schema.coverLetter.userId)),
				db.select({ value: count() }).from(schema.application).where(owned(schema.application.userId)),
				db
					.select({ value: count() })
					.from(schema.careerFact)
					.where(and(owned(schema.careerFact.userId), ne(schema.careerFact.status, "forgotten"))),
				db
					.select({ value: count() })
					.from(schema.careerFact)
					.where(and(owned(schema.careerFact.userId), isNotNull(schema.careerFact.applicationId))),
				db.select({ value: count() }).from(schema.careerStory).where(owned(schema.careerStory.userId)),
				db
					.select({ value: count() })
					.from(schema.careerStory)
					.where(and(owned(schema.careerStory.userId), isNotNull(schema.careerStory.applicationId))),
				db.select({ value: count() }).from(schema.careerFactGroup).where(owned(schema.careerFactGroup.userId)),
			]);
		const [opportunities, schedules, scopedSchedules, threads, scopedThreads, scopedArtifacts] = await Promise.all([
			db.select({ value: count() }).from(schema.careerOpportunity).where(owned(schema.careerOpportunity.userId)),
			db.select({ value: count() }).from(schema.careerSchedule).where(owned(schema.careerSchedule.userId)),
			db
				.select({ value: count() })
				.from(schema.careerSchedule)
				.where(and(owned(schema.careerSchedule.userId), isNotNull(schema.careerSchedule.applicationId))),
			db
				.select({ value: count() })
				.from(schema.agentThread)
				.where(and(owned(schema.agentThread.userId), isNull(schema.agentThread.deletedAt))),
			db
				.select({ value: count() })
				.from(schema.agentThread)
				.where(
					and(
						owned(schema.agentThread.userId),
						isNull(schema.agentThread.deletedAt),
						isNotNull(schema.agentThread.applicationId),
					),
				),
			db
				.select({ value: count() })
				.from(schema.careerArtifact)
				.where(and(owned(schema.careerArtifact.userId), isNotNull(schema.careerArtifact.applicationId))),
		]);
		return {
			documents: { resumes: total(resumes), letters: total(letters), locked: total(locked) },
			applications: {
				applications: total(applications),
				linked:
					total(scopedFacts) +
					total(scopedStories) +
					total(scopedArtifacts) +
					total(scopedSchedules) +
					total(scopedThreads),
			},
			knowledge: { facts: total(facts), stories: total(stories), groups: total(groups) },
			jobSearch: { opportunities: total(opportunities), schedules: total(schedules) },
			coach: { threads: total(threads) },
		};
	},

	run: (userId: string, input: Input): Promise<AccountImportResult> => {
		switch (input.area) {
			case "documents":
				return importDocuments(userId, input);
			case "applications":
				return importApplications(userId, input);
			case "knowledge":
				return importKnowledge(userId, input);
			case "jobSearch":
				return importJobSearch(userId, input);
			case "coach":
				return importCoach(userId, input);
			case "settings":
				return importSettings(userId, input);
		}
	},
};
