import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as tables from "@reactive-resume/db/schema";
import { copyCoverLetterStyle } from "@reactive-resume/resume/cover-letter";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

const fixture = vi.hoisted(() => ({
	db: undefined as ReturnType<typeof drizzle> | undefined,
	storageDelete: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@reactive-resume/db/client", () => ({
	get db() {
		return fixture.db;
	},
}));
vi.mock("../storage/service", async () => {
	const actual = await vi.importActual<typeof import("../storage/service")>("../storage/service");
	return { ...actual, getStorageService: () => ({ delete: fixture.storageDelete }) };
});

function getDb() {
	if (!fixture.db) throw new Error("Test database is not initialized.");
	return fixture.db;
}

const databaseUrl = process.env.INTEGRATIONS_TEST_DATABASE_URL ?? process.env.COVER_LETTER_TEST_DATABASE_URL;

// Records shaped like an "Export everything" archive, with the old ids the import must replace.
const archive = {
	resume: {
		id: "old-resume",
		name: "Platform lead",
		slug: "platform-lead",
		slugChosen: true,
		tags: ["main"],
		isPublic: true,
		isLocked: true,
		data: { ...structuredClone(defaultResumeData), basics: { ...defaultResumeData.basics, name: "Sam Example" } },
		createdAt: "2026-01-02T03:04:05.000Z",
		updatedAt: "2026-01-03T03:04:05.000Z",
	},
	letter: {
		id: "old-letter",
		name: "Letter to Lumen",
		recipient: "<p>Lumen</p><script>alert(1)</script>",
		content: "<p>I am applying.</p>",
		style: copyCoverLetterStyle(defaultResumeData),
		sourceResumeId: "old-resume",
		sourceApplicationId: "old-application",
		senderLinked: true,
		designLinked: true,
	},
	application: {
		id: "old-application",
		company: "Lumen",
		role: "Platform lead",
		status: "applied",
		resumeId: "old-resume",
		coverLetterId: "old-letter",
		sentResumeVersionId: "old-version",
		appliedAt: "2026-02-01T00:00:00.000Z",
		createdAt: "2026-02-01T00:00:00.000Z",
		updatedAt: "2026-02-02T00:00:00.000Z",
	},
	workspace: {
		applicationId: "old-application",
		data: {
			answers: [{ id: "a1", question: "Why us?", answer: "Reliability.", factIds: ["old-fact-shared"] }],
			checklist: [],
			questions: [],
			evidence: { "Runs incidents": "old-fact-scoped" },
			ticks: { plan: ["plan:old-artifact"] },
			message: "",
		},
	},
	facts: [
		{
			id: "old-fact-shared",
			applicationId: null,
			text: "Led the warehouse migration.",
			category: "accomplishment",
			source: { kind: "resume", id: "old-resume", quote: "Led the warehouse migration." },
			sourceKey: "key-shared",
			status: "active",
			revisions: [],
			group: "experience/lumen",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		},
		{
			id: "old-fact-scoped",
			applicationId: "old-application",
			text: "Lumen asked about on-call.",
			category: "preference",
			source: { kind: "manual", id: "note", quote: "Lumen asked about on-call." },
			sourceKey: "key-scoped",
			status: "excluded",
			revisions: [],
			group: null,
		},
		{ id: "broken-fact", text: 42 },
	],
	group: { group: "experience/lumen", status: "excluded", private: true },
	override: { applicationId: "old-application", group: null, factId: "old-fact-shared", mode: "include" },
	story: {
		id: "old-story",
		applicationId: null,
		data: {
			applicationId: null,
			title: "Migration",
			situation: "A warehouse moved.",
			task: "Keep it running.",
			action: "Planned the cutover.",
			result: "No downtime.",
			reflection: "",
			factIds: ["old-fact-shared", "missing-fact"],
			tags: [],
		},
	},
	artifact: {
		id: "old-artifact",
		applicationId: "old-application",
		interviewId: null,
		title: "Answers",
		data: { kind: "answers", answers: [{ question: "Why us?", answer: "Reliability." }] },
		evidence: { factIds: ["old-fact-shared"], storyIds: ["old-story"] },
		inputVersion: "v1",
	},
	opportunity: {
		url: "https://jobs.example.test/1",
		role: "SRE",
		company: "Lumen",
		snippet: "Run things.",
		trackedApplicationId: "old-application",
	},
	schedule: {
		id: "old-schedule",
		applicationId: null,
		kind: "discovery",
		query: "platform lead",
		enabled: true,
		nextRunAt: "2030-01-01T00:00:00.000Z",
		timezone: "UTC",
	},
	thread: {
		id: "old-thread",
		scope: "application",
		applicationId: "old-application",
		workingResumeId: "old-resume",
		title: "Prep",
		status: "active",
		aiProviderId: "someone-elses-provider",
	},
	deletedThread: { id: "old-deleted", scope: "career", title: "Gone", status: "deleted", deletedAt: "2026-01-01" },
	message: { threadId: "old-thread", role: "user", sequence: 0, status: "streaming", uiMessage: { parts: [] } },
};

describe.skipIf(!databaseUrl)("account import", () => {
	let service: typeof import("./service").accountImportService;
	let admin: Pool;
	let pool: Pool;
	const schemaName = `account_import_test_${randomUUID().replaceAll("-", "")}`;
	const userId = "import-owner";
	const otherId = "import-other";

	beforeAll(async () => {
		admin = new Pool({ connectionString: databaseUrl });
		await admin.query(`CREATE SCHEMA ${schemaName}`);
		pool = new Pool({ connectionString: databaseUrl, max: 1, options: `-c search_path=${schemaName}` });
		fixture.db = drizzle({ client: pool });
		const migrations = new URL("../../../../../migrations/", import.meta.url);
		const directories = (await readdir(migrations, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory() && /^\d+_/.test(entry.name))
			.map((entry) => entry.name)
			.sort();
		for (const directory of directories) {
			const file = new URL(`${directory}/migration.sql`, migrations);
			if (!existsSync(file)) continue;
			await pool.query((await readFile(file, "utf8")).replaceAll('"public".', ""));
		}
		await getDb()
			.insert(tables.user)
			.values([
				{ id: userId, name: "Owner", email: "owner@example.test", username: "import-owner", displayUsername: "Owner" },
				{ id: otherId, name: "Other", email: "other@example.test", username: "import-other", displayUsername: "Other" },
			]);
		service = (await import("./service")).accountImportService;
	}, 60_000);

	afterAll(async () => {
		await pool?.end();
		await admin?.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
		await admin?.end();
	});

	it("imports every area with new ids and rewritten links", async () => {
		const documents = await service.run(userId, {
			area: "documents",
			mode: "append",
			resumes: [archive.resume, { id: "bad-resume", data: { nope: true } }],
			letters: [archive.letter],
		});
		const resumeId = documents.ids.resume?.["old-resume"];
		const letterId = documents.ids.letter?.["old-letter"];
		expect(resumeId).toBeDefined();
		expect(resumeId).not.toBe("old-resume");
		expect(documents.madePrivate).toBe(1);
		expect(documents.skipped).toContainEqual({ kind: "resumes", reason: "unreadable", count: 1 });

		const [resume] = await getDb()
			.select()
			.from(tables.resume)
			.where(eq(tables.resume.id, resumeId ?? ""));
		expect(resume).toMatchObject({
			userId,
			slug: "platform-lead",
			slugChosen: true,
			isPublic: false,
			isLocked: true,
			tags: ["main"],
		});
		expect(resume?.createdAt.toISOString()).toBe("2026-01-02T03:04:05.000Z");
		const [letter] = await getDb()
			.select()
			.from(tables.coverLetter)
			.where(eq(tables.coverLetter.id, letterId ?? ""));
		expect(letter?.sourceResumeId).toBe(resumeId);
		expect(letter?.recipient).not.toContain("<script>");
		expect(
			await getDb()
				.select()
				.from(tables.resumeVersion)
				.where(eq(tables.resumeVersion.resumeId, resumeId ?? "")),
		).toHaveLength(1);

		const applications = await service.run(userId, {
			area: "applications",
			mode: "append",
			ids: documents.ids,
			applications: [archive.application],
			workspaces: [archive.workspace],
			letterLinks: [{ letterId: "old-letter", applicationId: "old-application" }],
		});
		const applicationId = applications.ids.application?.["old-application"];
		const [application] = await getDb()
			.select()
			.from(tables.application)
			.where(eq(tables.application.id, applicationId ?? ""));
		expect(application).toMatchObject({ userId, resumeId, coverLetterId: letterId, sentResumeVersionId: null });
		const [linkedLetter] = await getDb()
			.select()
			.from(tables.coverLetter)
			.where(eq(tables.coverLetter.id, letterId ?? ""));
		expect(linkedLetter?.sourceApplicationId).toBe(applicationId);

		const ids = { ...documents.ids, ...applications.ids };
		const knowledge = await service.run(userId, {
			area: "knowledge",
			mode: "append",
			ids,
			facts: archive.facts,
			groups: [archive.group],
			overrides: [archive.override],
			stories: [archive.story],
			artifacts: [archive.artifact],
		});
		const sharedFact = knowledge.ids.fact?.["old-fact-shared"];
		const scopedFact = knowledge.ids.fact?.["old-fact-scoped"];
		const artifactId = knowledge.ids.artifact?.["old-artifact"];
		const storyId = knowledge.ids.story?.["old-story"];
		expect(knowledge.added).toMatchObject({ facts: 2, groups: 1, overrides: 1, stories: 1, artifacts: 1 });
		expect(knowledge.skipped).toContainEqual({ kind: "facts", reason: "unreadable", count: 1 });

		const facts = await getDb().select().from(tables.careerFact).where(eq(tables.careerFact.userId, userId));
		expect(facts.find((fact) => fact.id === sharedFact)).toMatchObject({
			source: { kind: "resume", id: resumeId, quote: "Led the warehouse migration." },
			group: "experience/lumen",
			applicationId: null,
		});
		expect(facts.find((fact) => fact.id === scopedFact)).toMatchObject({ applicationId, status: "excluded" });
		const [story] = await getDb()
			.select()
			.from(tables.careerStory)
			.where(eq(tables.careerStory.id, storyId ?? ""));
		expect(story?.data.factIds).toEqual([sharedFact]);
		const [artifact] = await getDb()
			.select()
			.from(tables.careerArtifact)
			.where(eq(tables.careerArtifact.id, artifactId ?? ""));
		expect(artifact?.evidence).toEqual({ factIds: [sharedFact], storyIds: [storyId] });
		const [override] = await getDb()
			.select()
			.from(tables.careerFactOverride)
			.where(eq(tables.careerFactOverride.userId, userId));
		expect(override).toMatchObject({ applicationId, factId: sharedFact, mode: "include" });
		const [group] = await getDb()
			.select()
			.from(tables.careerFactGroup)
			.where(eq(tables.careerFactGroup.userId, userId));
		expect(group).toMatchObject({ group: "experience/lumen", status: "excluded", private: true });
		const [workspace] = await getDb()
			.select()
			.from(tables.careerWorkspace)
			.where(eq(tables.careerWorkspace.applicationId, applicationId ?? ""));
		expect(workspace?.data.answers[0]?.factIds).toEqual([sharedFact]);
		expect(workspace?.data.evidence).toEqual({ "Runs incidents": scopedFact });
		expect(workspace?.data.ticks).toEqual({ plan: [`plan:${artifactId}`] });

		const jobSearch = await service.run(userId, {
			area: "jobSearch",
			mode: "append",
			ids,
			opportunities: [archive.opportunity],
			schedules: [archive.schedule],
		});
		expect(jobSearch.added).toEqual({ opportunities: 1, schedules: 1 });
		const [schedule] = await getDb()
			.select()
			.from(tables.careerSchedule)
			.where(eq(tables.careerSchedule.userId, userId));
		expect(schedule?.enabled).toBe(false);
		const [opportunity] = await getDb()
			.select()
			.from(tables.careerOpportunity)
			.where(eq(tables.careerOpportunity.userId, userId));
		expect(opportunity?.trackedApplicationId).toBe(applicationId);

		const coach = await service.run(userId, {
			area: "coach",
			mode: "append",
			ids,
			threads: [archive.thread, archive.deletedThread],
			messages: [archive.message],
			transcripts: [],
		});
		expect(coach.added).toEqual({ threads: 1, messages: 1 });
		const [thread] = await getDb().select().from(tables.agentThread).where(eq(tables.agentThread.userId, userId));
		expect(thread).toMatchObject({ applicationId, workingResumeId: resumeId, aiProviderId: null });
		const [message] = await getDb().select().from(tables.agentMessage).where(eq(tables.agentMessage.userId, userId));
		expect(message).toMatchObject({ threadId: thread?.id, status: "completed" });

		const settings = await service.run(userId, {
			area: "settings",
			preferences: { resumePages: 2, noReplyDays: 14, interviewReminders: false },
			aiLimits: { coachFacts: 99 },
			profile: { targetRoles: ["Platform lead"] },
		});
		expect(settings.added).toEqual({ preferences: 1, aiLimits: 1, profile: 1 });
		const [owner] = await getDb().select().from(tables.user).where(eq(tables.user.id, userId));
		expect(owner).toMatchObject({ resumePages: 2, noReplyDays: 14, interviewReminders: false });
	});

	it("skips facts the account already has and maps records to them", async () => {
		const again = await service.run(userId, {
			area: "knowledge",
			mode: "append",
			ids: {},
			facts: archive.facts.slice(0, 1),
			groups: [archive.group],
			overrides: [],
			stories: [archive.story],
			artifacts: [],
		});
		expect(again.added).toEqual({ stories: 1 });
		expect(again.skipped).toEqual(
			expect.arrayContaining([
				{ kind: "facts", reason: "exists", count: 1 },
				{ kind: "groups", reason: "exists", count: 1 },
			]),
		);
		const [existing] = await getDb()
			.select({ id: tables.careerFact.id })
			.from(tables.careerFact)
			.where(and(eq(tables.careerFact.userId, userId), eq(tables.careerFact.sourceKey, "key-shared")));
		expect(again.ids.fact?.["old-fact-shared"]).toBe(existing?.id);
	});

	it("ignores ids that point at another user's records", async () => {
		const [foreign] = await getDb()
			.insert(tables.resume)
			.values({ userId: otherId, name: "Theirs", slug: "theirs", data: defaultResumeData })
			.returning();
		const result = await service.run(userId, {
			area: "applications",
			mode: "append",
			ids: { resume: { "old-resume": foreign?.id ?? "" } },
			applications: [{ ...archive.application, id: "another-application" }],
			workspaces: [],
			letterLinks: [],
		});
		const [application] = await getDb()
			.select()
			.from(tables.application)
			.where(eq(tables.application.id, result.ids.application?.["another-application"] ?? ""));
		expect(application?.resumeId).toBeNull();
	});

	it("replaces a whole area, and replacing applications removes what was tied to them", async () => {
		const before = await service.preview(userId);
		expect(before.applications.applications).toBe(2);
		expect(before.applications.linked).toBeGreaterThan(0);

		await service.run(userId, {
			area: "applications",
			mode: "replace",
			ids: {},
			applications: [{ ...archive.application, id: "fresh", resumeId: null, coverLetterId: null }],
			workspaces: [],
			letterLinks: [],
		});
		const after = await service.preview(userId);
		expect(after.applications).toEqual({ applications: 1, linked: 0 });
		// The scoped fact went with its application; the shared one stays.
		expect(after.knowledge.facts).toBe(1);

		await service.run(userId, {
			area: "knowledge",
			mode: "replace",
			ids: {},
			facts: [],
			groups: [],
			overrides: [],
			stories: [],
			artifacts: [],
		});
		expect((await service.preview(userId)).knowledge).toEqual({ facts: 0, stories: 0, groups: 0 });
	});
});
