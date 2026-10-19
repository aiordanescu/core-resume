import type { CareerSource } from "@reactive-resume/schema/career";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as tables from "@reactive-resume/db/schema";
import { copyCoverLetterStyle } from "@reactive-resume/resume/cover-letter";
import { careerProfileDataSchema, aiLimitsSchema, savedItemDataSchema } from "@reactive-resume/schema/career";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

const fixture = vi.hoisted(() => ({
	db: undefined as ReturnType<typeof drizzle> | undefined,
	generate: vi.fn(),
	storageDelete: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@reactive-resume/db/client", () => ({
	get db() {
		return fixture.db;
	},
}));

vi.mock("../applications/ai", () => ({ generateJson: fixture.generate }));
vi.mock("../ai-providers/service", () => ({
	aiProvidersService: {
		getRunnableById: async () => ({ id: "fixture", provider: "openai", model: "fixture", apiKey: "synthetic" }),
		getDefaultRunnable: async () => ({ id: "fixture", provider: "openai", model: "fixture", apiKey: "synthetic" }),
	},
}));
vi.mock("../ai/service", () => ({ getModel: () => ({}) }));
vi.mock("../storage/service", async () => {
	const actual = await vi.importActual<typeof import("../storage/service")>("../storage/service");
	return { ...actual, getStorageService: () => ({ delete: fixture.storageDelete }) };
});

function getDb() {
	if (!fixture.db) throw new Error("Test database is not initialized.");
	return fixture.db;
}

const databaseUrl = process.env.INTEGRATIONS_TEST_DATABASE_URL ?? process.env.COVER_LETTER_TEST_DATABASE_URL;
const round = {
	id: "alice-round",
	type: "interview" as const,
	at: new Date("2030-10-08T10:00:00Z"),
	kind: "technical" as const,
	durationMinutes: 45,
	location: "Video",
	notes: "Reliability discussion",
	audience: "practitioner" as const,
	participants: [{ name: "Alex Example", role: "Technical lead" }],
	timezone: "Europe/Berlin",
};

function resumeData(headline: string) {
	const data = structuredClone(defaultResumeData);
	data.basics.headline = headline;
	return data;
}

// Real PostgreSQL, opt-in only. Every table and FK comes from shipped migrations in a unique schema.
describe.skipIf(!databaseUrl)("career knowledge, context and data lifecycle", () => {
	let service: typeof import("./service").careerService;
	let applications: typeof import("../applications/service").applicationService;
	let admin: Pool;
	let pool: Pool;
	const schemaName = `career_test_${randomUUID().replaceAll("-", "")}`;

	beforeAll(async () => {
		admin = new Pool({ connectionString: databaseUrl });
		await admin.query(`CREATE SCHEMA ${schemaName}`);
		// Match deployments with a single request connection; nested global queries must not deadlock.
		pool = new Pool({
			connectionString: databaseUrl,
			max: 1,
			connectionTimeoutMillis: 2000,
			options: `-c search_path=${schemaName}`,
		});
		fixture.db = drizzle({ client: pool });
		const migrations = new URL("../../../../../migrations/", import.meta.url);
		const directories = (await readdir(migrations, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory() && /^\d+_/.test(entry.name))
			.map((entry) => entry.name)
			.sort();
		for (const directory of directories) {
			const file = new URL(`${directory}/migration.sql`, migrations);
			if (!existsSync(file)) continue;
			const migration = await readFile(file, "utf8");
			await pool.query(migration.replaceAll('"public".', ""));
		}
		service = (await import("./service")).careerService;
		applications = (await import("../applications/service")).applicationService;
	}, 30_000);

	afterAll(async () => {
		await pool?.end();
		await admin?.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
		await admin?.end();
	});

	async function thread(id: string, userId: string, applicationId: string | null) {
		await getDb()
			.insert(tables.agentThread)
			.values({
				id,
				userId,
				applicationId,
				scope: applicationId ? "application" : "career",
				title: "Synthetic coaching",
			});
	}

	async function fact(userId: string, text: string, applicationId: string | null = null, source?: CareerSource) {
		const saved = await service.saveFact(userId, {
			applicationId,
			text,
			category: "accomplishment",
			source: source ?? { kind: "manual", id: randomUUID(), quote: text },
		});
		if (!saved) throw new Error("Expected a new fact.");
		return saved;
	}

	function story(factIds: string[], applicationId: string | null = null) {
		return {
			applicationId,
			title: "Reliability incident",
			situation: "A service failed.",
			task: "Restore service.",
			action: "Coordinated the response.",
			result: "Service recovered.",
			reflection: "Document the handoff.",
			factIds,
			tags: ["reliability"],
		};
	}

	const fit = { kind: "fit", headline: "A relevant role", summary: "", requirements: [], checks: [], ask: null };

	async function savedItem(applicationId: string, data: unknown, factIds: string[] = []) {
		const context = await service.context({ userId: "alice", applicationId });
		const item = await service.saveSavedItem({
			userId: "alice",
			applicationId,
			interviewId: null,
			title: "Synthetic item",
			data: savedItemDataSchema.parse(data),
			evidence: { factIds, storyIds: [] },
			inputVersion: context.version,
		});
		if (!item) throw new Error("Expected a saved item.");
		return item;
	}

	beforeEach(async () => {
		fixture.generate.mockReset();
		fixture.storageDelete.mockReset().mockResolvedValue(undefined);
		await pool.query('TRUNCATE "user" CASCADE');
		await getDb()
			.insert(tables.user)
			.values(
				["alice", "bob"].map((id) => ({
					id,
					name: id,
					email: `${id}@example.test`,
					username: id,
					displayUsername: id,
				})),
			);
		await getDb()
			.insert(tables.resume)
			.values([
				{
					id: "shared-resume",
					userId: "alice",
					name: "Current",
					slug: "current",
					data: resumeData("LIVE UNSUBMITTED DRAFT"),
				},
				{ id: "bob-resume", userId: "bob", name: "Bob", slug: "bob", data: resumeData("Bob private history") },
			]);
		await getDb()
			.insert(tables.resumeVersion)
			.values([
				{
					id: "sent-acme",
					resumeId: "shared-resume",
					userId: "alice",
					kind: "sent",
					data: resumeData("ACME submitted reliability lead"),
				},
				{
					id: "sent-nova",
					resumeId: "shared-resume",
					userId: "alice",
					kind: "sent",
					data: resumeData("NOVA submitted mentor"),
				},
				{
					id: "sent-bob",
					resumeId: "bob-resume",
					userId: "bob",
					kind: "sent",
					data: resumeData("Bob private history"),
				},
			]);
		await getDb()
			.insert(tables.application)
			.values([
				{
					id: "alice-app",
					userId: "alice",
					company: "ACME",
					role: "Reliability engineer",
					resumeId: "shared-resume",
					sentResumeVersionId: "sent-acme",
					activity: [round],
					updatedAt: new Date("2026-01-01T00:00:00Z"),
				},
				{
					id: "alice-other",
					userId: "alice",
					company: "NOVA",
					role: "Engineering mentor",
					resumeId: "shared-resume",
					sentResumeVersionId: "sent-nova",
					activity: [{ ...round, id: "nova-round", notes: "Mentorship discussion" }],
				},
				{ id: "bob-app", userId: "bob", company: "Other", role: "Designer", resumeId: "bob-resume" },
			]);
		await thread("alice-shared", "alice", null);
		await thread("alice-private", "alice", "alice-app");
		await thread("bob-private", "bob", "bob-app");
		await getDb()
			.insert(tables.agentMessage)
			.values([
				{
					id: "alice-message",
					userId: "alice",
					threadId: "alice-shared",
					role: "user",
					sequence: 1,
					uiMessage: {
						role: "user",
						parts: [{ type: "text", text: "I reduced recovery time by 40 percent during the migration." }],
					},
				},
				{
					id: "private-message",
					userId: "alice",
					threadId: "alice-private",
					role: "user",
					sequence: 1,
					uiMessage: { role: "user", parts: [{ type: "text", text: "My ACME interview notes are private." }] },
				},
				{
					id: "bob-message",
					userId: "bob",
					threadId: "bob-private",
					role: "user",
					sequence: 1,
					uiMessage: { role: "user", parts: [{ type: "text", text: "Bob private accomplishment." }] },
				},
			]);
	});

	it("isolates accounts and application-private evidence until its owner explicitly shares it", async () => {
		const shared = await fact("alice", "I mentor junior engineers.");
		const privateFact = await fact("alice", "My ACME interview notes are private.", "alice-app", {
			kind: "user-message",
			id: "private-message",
			quote: "My ACME interview notes are private.",
		});
		const bob = await fact("bob", "Bob private accomplishment.");
		const privateStory = await service.saveStory("alice", story([privateFact.id], "alice-app"));
		expect(
			(await service.context({ userId: "alice", applicationId: "alice-app" })).facts.map((item) => item.id).sort(),
		).toEqual([shared.id, privateFact.id].sort());
		expect(
			(await service.context({ userId: "alice", applicationId: "alice-other" })).facts.map((item) => item.id),
		).toEqual([shared.id]);
		expect(await service.stories({ userId: "alice" })).toEqual([]);
		await expect(service.context({ userId: "bob", applicationId: "alice-app" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(
			fact("alice", "Bob private accomplishment.", null, {
				kind: "user-message",
				id: "bob-message",
				quote: "Bob private accomplishment.",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(fact("alice", privateFact.text, null, privateFact.source)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(service.saveStory("alice", story([bob.id]))).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(service.saveStory("alice", story([privateFact.id]))).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(service.updateFact("bob", { id: privateFact.id, text: "Overwrite" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(service.forgetFact("bob", privateFact.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
		await service.deleteStory("bob", privateStory.id);
		expect((await service.stories({ userId: "alice", applicationId: "alice-app" })).map((item) => item.id)).toEqual([
			privateStory.id,
		]);
		await service.updateFact("alice", { id: privateFact.id, share: true });
		expect((await service.context({ userId: "alice" })).facts.map((item) => item.id)).toContain(privateFact.id);
		expect((await service.context({ userId: "bob" })).facts.map((item) => item.id)).toEqual([bob.id]);
	});

	it("resolves each application's submitted versions and verifies quotations against that version", async () => {
		const style = copyCoverLetterStyle(defaultResumeData);
		await getDb().insert(tables.coverLetter).values({
			id: "alice-letter",
			userId: "alice",
			name: "Current letter",
			content: "<p>UNSENT LETTER EDIT</p>",
			style,
		});
		await getDb()
			.insert(tables.coverLetterVersion)
			.values({
				id: "sent-letter",
				userId: "alice",
				coverLetterId: "alice-letter",
				kind: "sent",
				data: {
					name: "Sent letter",
					recipient: "ACME",
					content: "<p>I coordinated recovery.</p>",
					style,
					layout: "freeform",
					recipientName: "",
					recipientCompany: "ACME",
					letterDate: null,
				},
			});
		await getDb()
			.update(tables.application)
			.set({ coverLetterId: "alice-letter", sentCoverLetterVersionId: "sent-letter" })
			.where(eq(tables.application.id, "alice-app"));
		const acme = await service.context({ userId: "alice", applicationId: "alice-app", interviewId: "alice-round" });
		const nova = await service.context({ userId: "alice", applicationId: "alice-other", interviewId: "nova-round" });
		expect(acme).toMatchObject({
			application: { company: "ACME" },
			interview: { id: "alice-round", notes: "Reliability discussion" },
			resume: { submitted: true, version: "sent-acme", source: { kind: "resume-version", id: "sent-acme" } },
			letter: { submitted: true, version: "sent-letter", text: "<p>I coordinated recovery.</p>" },
		});
		expect(nova).toMatchObject({
			application: { company: "NOVA" },
			interview: { id: "nova-round" },
			resume: { version: "sent-nova" },
		});
		expect(acme.resume?.text).toContain("ACME submitted reliability lead");
		expect(acme.resume?.text).not.toContain("LIVE UNSUBMITTED DRAFT");
		expect(nova.resume?.text).toContain("NOVA submitted mentor");
		await expect(
			service.context({ userId: "alice", applicationId: "alice-app", interviewId: "nova-round" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		const source: CareerSource = { kind: "resume-version", id: "sent-acme", quote: "ACME submitted reliability lead" };
		expect(await fact("alice", source.quote, "alice-app", source)).toMatchObject({ source });
		await expect(
			fact("alice", "Invented claim", "alice-app", { ...source, quote: "NOVA submitted mentor" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(
			fact("alice", "Bob private history", null, {
				kind: "resume-version",
				id: "sent-bob",
				quote: "Bob private history",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("keeps stories and saved items through a correction, unlinks a forgotten fact, and blocks re-extraction", async () => {
		const original = "I reduced recovery time by 40 percent";
		const remembered = {
			applicationId: null,
			text: original,
			category: "accomplishment" as const,
			source: { kind: "user-message" as const, id: "alice-message", quote: original },
		};
		// Automatic memory saves nothing until the user switches it from "ask" (the default) to "auto".
		expect(await service.saveFact("alice", remembered, true)).toBeNull();
		await service.saveProfile("alice", careerProfileDataSchema.parse({ memoryMode: "auto" }));
		const saved = await service.saveFact("alice", remembered, true);
		if (!saved) throw new Error("Expected automatic memory.");
		const kept = await fact("alice", "I mentor junior engineers.");
		const savedStory = await service.saveStory("alice", story([saved.id, kept.id]));
		const item = await savedItem("alice-app", fit, [saved.id, kept.id]);
		const beforeCorrection = await service.context({ userId: "alice" });
		await service.updateFact("alice", { id: saved.id, text: "I reduced recovery time by 25 percent." });
		const context = await service.context({ userId: "alice" });
		expect(context.facts.find((entry) => entry.id === saved.id)).toMatchObject({
			text: "I reduced recovery time by 25 percent.",
			source: { kind: "user-message", id: "alice-message" },
		});
		await expect(
			service.saveStory("alice", { ...story([saved.id]), result: original }, undefined, beforeCorrection.memoryVersion),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(JSON.stringify(context)).not.toContain("40 percent");
		expect((await service.facts({ userId: "alice" })).find((entry) => entry.id === saved.id)?.revisions).toMatchObject([
			{ text: original },
		]);
		expect(await service.stories({ userId: "alice" })).toMatchObject([
			{ id: savedStory.id, data: { factIds: [saved.id, kept.id] } },
		]);
		expect(await service.savedItems({ userId: "alice", applicationId: "alice-app" })).toMatchObject([
			{ id: item.id, evidence: { factIds: [saved.id, kept.id] } },
		]);
		await service.forgetFact("alice", saved.id);
		expect((await service.facts({ userId: "alice" })).map((entry) => entry.id)).toEqual([kept.id]);
		expect(await service.stories({ userId: "alice" })).toMatchObject([{ id: savedStory.id, data: { factIds: [] } }]);
		expect(await service.savedItems({ userId: "alice", applicationId: "alice-app" })).toMatchObject([
			{ id: item.id, evidence: { factIds: [kept.id] } },
		]);
		const expanded = "I reduced recovery time by 40 percent during the migration.";
		expect(
			await service.saveFact(
				"alice",
				{ ...remembered, text: expanded, source: { ...remembered.source, quote: expanded } },
				true,
			),
		).toBeNull();
		expect((await service.exportData("alice")).facts).toContainEqual(
			expect.objectContaining({
				id: saved.id,
				status: "forgotten",
				text: "",
				revisions: [],
				source: expect.objectContaining({ quote: "" }),
			}),
		);
	});

	it("gives the coach real interview debriefs, never practice, and only when memory is shared", async () => {
		await savedItem("alice-app", {
			kind: "practice",
			question: "Describe an incident.",
			origin: "simulated",
			mode: "typed",
			answer: "I coordinated the response.",
			title: "Clear",
			works: "",
			strengthen: "",
			opening: "",
			note: "Clear",
		});
		await savedItem("alice-app", {
			kind: "debrief",
			round: "Technical",
			question: "Describe an incident.",
			answer: "I coordinated the response.",
			landed: "well",
			title: "Landed",
			verdicts: [],
			nextRound: "",
			priority: "",
			plan: [],
		});
		const { buildCareerTools } = await import("./tools");
		const input = {
			userId: "alice",
			context: await service.context({ userId: "alice", applicationId: "alice-app" }),
			shareApplication: true,
			shareMemory: true,
			tab: undefined,
			sourceMessageId: undefined,
		};
		const history = buildCareerTools(input).read_real_interview_history?.execute?.(
			{},
			{
				toolCallId: "history",
				messages: [],
				context: {},
			},
		);
		expect(await history).toMatchObject([{ data: { kind: "debrief" } }]);
		expect(buildCareerTools({ ...input, shareMemory: false })).not.toHaveProperty("read_real_interview_history");
	});

	it.each(["corrected", "excluded", "forgotten"] as const)(
		"keeps debriefs containing %s facts out of subsequent coaching without deleting saved work",
		async (change) => {
			const original = await fact("alice", "I led confidential Project Willow.");
			const debrief = {
				kind: "debrief",
				round: "Technical",
				question: "Describe a project.",
				answer: "I described my work.",
				landed: "well",
				title: "Use a concrete example",
				verdicts: [{ tag: "supported", text: original.text }],
				nextRound: "Prepare another example.",
				priority: "",
				plan: [],
			};
			const old = await savedItem("alice-app", debrief, [original.id]);
			if (change === "forgotten") await service.forgetFact("alice", original.id);
			else
				await service.updateFact("alice", {
					id: original.id,
					...(change === "corrected" ? { text: "I contributed to Project Willow." } : { status: "excluded" }),
				});
			const current = { ...debrief, title: "A fresh debrief", verdicts: [] };
			await savedItem("alice-app", current);
			const context = await service.context({ userId: "alice", applicationId: "alice-app" });
			expect(JSON.stringify(context)).not.toContain(original.text);
			const { buildCareerTools } = await import("./tools");
			const tools = buildCareerTools({
				userId: "alice",
				context,
				shareApplication: true,
				shareMemory: true,
				tab: undefined,
				sourceMessageId: undefined,
			});
			const history = await tools.read_real_interview_history?.execute?.(
				{},
				{ toolCallId: "history", messages: [], context: {} },
			);
			expect(history).toMatchObject([{ data: current }]);
			expect(JSON.stringify(history)).not.toContain(original.text);
			expect(await service.savedItems({ userId: "alice", applicationId: "alice-app" })).toContainEqual(
				expect.objectContaining({ id: old.id, data: expect.objectContaining({ verdicts: debrief.verdicts }) }),
			);
		},
	);

	it("marks saved items outdated when the application or its interview changes, within that application", async () => {
		const first = await savedItem("alice-app", fit);
		const outdated = async (id: string) =>
			(await service.savedItems({ userId: "alice", applicationId: "alice-app" })).find((item) => item.id === id)
				?.outdated;
		expect(await outdated(first.id)).toBe(false);
		await applications.update({ userId: "alice", id: "alice-app", company: "ACME Labs" });
		expect(await outdated(first.id)).toBe(true);
		const second = await savedItem("alice-app", fit);
		expect(await outdated(second.id)).toBe(false);
		await applications.updateInterview({
			userId: "alice",
			id: "alice-app",
			entryId: round.id,
			audience: "panel",
			participants: [{ name: "Sam Example", role: "Panel chair" }],
		});
		expect(await outdated(second.id)).toBe(true);
		expect(await service.savedItems({ userId: "alice", applicationId: "alice-other" })).toEqual([]);
		expect(
			(await service.exportData("alice")).messages.find((message) => message.id === "private-message")?.uiMessage,
		).toEqual({ role: "user", parts: [{ type: "text", text: "My ACME interview notes are private." }] });
	});

	it("applies only the ticked reply changes, once, and never moves a Saved application past Applied", async () => {
		const reply = await savedItem("alice-app", {
			kind: "reply",
			message: "We'd like to invite you to the next round and can offer EUR 90,000.",
			title: "They're inviting you to the next round",
			asks: [],
			unconfirmed: [],
			reply: "",
			changes: [
				{ type: "stage", stage: "interview" },
				{ type: "follow-up", at: "2030-10-09T09:00:00Z", note: "Confirm a time." },
				{ type: "offer" },
			],
			offer: { currency: "EUR", period: "year", base: 90_000, variable: null },
		});
		const savedApplication = await applications.getById({ userId: "alice", id: "alice-app" });
		await expect(service.applyReply("alice", reply.id, [0])).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: "Mark the application as applied first.",
		});
		expect(await applications.getById({ userId: "alice", id: "alice-app" })).toEqual(savedApplication);
		await applications.update({ userId: "alice", id: "alice-app", status: "applied" });
		await expect(service.applyReply("alice", reply.id, [1, 2])).rejects.toMatchObject({ code: "CONFLICT" });
		const refreshed = await savedItem("alice-app", reply.data);
		await service.applyReply("alice", refreshed.id, [1, 2]);
		const applied = await applications.getById({ userId: "alice", id: "alice-app" });
		expect(applied).toMatchObject({
			status: "applied",
			followUpAt: new Date("2030-10-09T09:00:00Z"),
			followUpNote: "Confirm a time.",
		});
		const items = await service.savedItems({ userId: "alice", applicationId: "alice-app" });
		expect(items.find((item) => item.id === refreshed.id)?.data).toMatchObject({ applied: { changes: [1, 2] } });
		expect(items.filter((item) => item.data.kind === "offer")).toMatchObject([
			{ data: { base: 90_000, currency: "EUR" } },
		]);
		await service.applyReply("alice", refreshed.id, [0, 2]);
		expect(await applications.getById({ userId: "alice", id: "alice-app" })).toEqual(applied);
		expect((await service.savedItems({ userId: "alice", applicationId: "alice-app", kind: "offer" })).length).toBe(1);
	});

	it("keeps workspace keys a partial save leaves out, and only the owner can write it", async () => {
		const answers = [{ id: "why", question: "Why ACME?", answer: "Reliability work.", factIds: [] }];
		await service.saveWorkspace("alice", "alice-app", { answers, checklist: [1] }, { answers: [], checklist: [] });
		await service.saveWorkspace("alice", "alice-app", { message: "Thanks for applying." }, { message: "" });
		await expect(
			service.saveWorkspace("bob", "alice-app", { message: "Overwrite" }, { message: "" }),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		expect(await service.workspace("alice", "alice-app")).toMatchObject({
			answers,
			checklist: [1],
			message: "Thanks for applying.",
		});
	});

	it("exports source metadata and owned coaching records without credentials, then cascades account deletion", async () => {
		await service.saveProfile("alice", careerProfileDataSchema.parse({ priorities: "Autonomy" }));
		const saved = await fact("alice", "I mentor junior engineers.");
		await fact("bob", "Bob keeps this fact.");
		await service.saveStory("alice", story([saved.id]));
		await savedItem("alice-app", fit, [saved.id]);
		await service.saveWorkspace("alice", "alice-app", { message: "Thanks for applying." }, { message: "" });
		await getDb().insert(tables.aiProvider).values({
			id: "alice-provider",
			userId: "alice",
			label: "Fixture",
			provider: "openai",
			model: "fixture-model",
			encryptedApiKey: "secret-in-fixture",
			apiKeySalt: "private-salt",
			apiKeyHash: "private-hash",
			apiKeyPreview: "private-preview",
		});
		await getDb()
			.insert(tables.careerSchedule)
			.values({
				id: "alice-schedule",
				userId: "alice",
				kind: "discovery",
				query: "Mentoring roles",
				nextRunAt: new Date("2030-10-08T09:00:00Z"),
			});
		await getDb()
			.insert(tables.careerJob)
			.values({
				id: "alice-job",
				userId: "alice",
				scheduleId: "alice-schedule",
				dueAt: new Date("2030-10-08T09:00:00Z"),
			});
		await getDb()
			.insert(tables.careerNotification)
			.values({ userId: "alice", key: "fixture-notification", notice: { type: "briefing-paused" } });
		await getDb().insert(tables.careerOpportunity).values({
			userId: "alice",
			role: "Mentor",
			url: "https://example.test/jobs/mentor",
			snippet: "Synthetic posting",
		});
		await getDb().insert(tables.careerTranscript).values({
			userId: "alice",
			original: "I mentored a colleague",
			edited: "I mentored two colleagues",
			model: "fixture-transcription",
		});
		await getDb().insert(tables.agentAttachment).values({
			userId: "alice",
			threadId: "alice-shared",
			messageId: "alice-message",
			storageKey: "uploads/alice/agent/alice-shared/notes",
			filename: "notes.txt",
			mediaType: "text/plain",
			size: 42,
		});
		const exported = await service.exportData("alice");
		expect(exported).toMatchObject({
			profile: { priorities: "Autonomy" },
			threads: expect.arrayContaining([
				expect.objectContaining({
					id: "alice-private",
					scope: "application",
					applicationId: "alice-app",
				}),
			]),
			facts: [{ text: "I mentor junior engineers.", source: { kind: "manual", quote: "I mentor junior engineers." } }],
			artifacts: [{ evidence: { factIds: [saved.id] } }],
			jobs: [{ id: "alice-job" }],
			transcripts: [{ original: "I mentored a colleague", edited: "I mentored two colleagues" }],
			attachments: [{ filename: "notes.txt", storageKey: "uploads/alice/agent/alice-shared/notes" }],
		});
		for (const key of [
			"stories",
			"schedules",
			"notifications",
			"threads",
			"messages",
			"opportunities",
			"workspaces",
		] as const)
			expect(exported[key].length).toBeGreaterThan(0);
		expect(JSON.stringify(exported)).not.toContain("Bob keeps this fact");
		expect(JSON.stringify(exported)).not.toContain("secret-in-fixture");
		// This is the account-deletion database boundary; file removal is outside this database fixture.
		await getDb().delete(tables.user).where(eq(tables.user.id, "alice"));
		const remaining = await service.exportData("alice");
		for (const [key, value] of Object.entries(remaining)) if (key !== "profile") expect(value, key).toEqual([]);
		expect(await getDb().select().from(tables.careerProfile).where(eq(tables.careerProfile.userId, "alice"))).toEqual(
			[],
		);
		expect((await service.exportData("bob")).facts).toMatchObject([{ text: "Bob keeps this fact." }]);
	});
	it("tracks a role once even when two tabs track it with one database connection", async () => {
		await getDb().insert(tables.careerOpportunity).values({
			id: "track-me",
			userId: "alice",
			url: "https://example.test/jobs/track",
			role: "Reliability engineer",
			company: "ACME",
			snippet: "Role",
		});
		const [left, right] = await Promise.all([
			service.trackOpportunity("alice", "track-me"),
			service.trackOpportunity("alice", "track-me"),
		]);
		expect(left).toEqual(right);
		expect(await applications.getById({ userId: "alice", id: left.applicationId })).toMatchObject({
			status: "saved",
			company: "ACME",
			sourceUrl: "https://example.test/jobs/track",
		});
		await expect(service.trackOpportunity("bob", "track-me")).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it.each(["fit", "answer"] as const)("rejects an in-flight %s after a supporting fact is forgotten", async (task) => {
		const remembered = await fact("alice", "I reduced recovery time by 40 percent.");
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		fixture.generate.mockImplementationOnce(async () => {
			started.resolve();
			await release.promise;
			return task === "answer"
				? { text: "I reduced recovery time by 40 percent.", factIds: [remembered.id] }
				: {
						headline: "Strong evidence",
						summary: "Reduced recovery time by 40 percent.",
						requirements: [],
						checks: [],
						ask: null,
						factIds: [remembered.id],
					};
		});
		const { generateCareer } = await import("./generate");
		const pending = generateCareer({
			userId: "alice",
			applicationId: "alice-app",
			locale: "en-US",
			task: task === "fit" ? { task } : { task, question: "Why you?", answer: "" },
		});
		await started.promise;
		await service.forgetFact("alice", remembered.id);
		release.resolve();
		await expect(pending).rejects.toMatchObject({ code: "CONFLICT" });
		expect(await getDb().select().from(tables.careerArtifact)).toEqual([]);
	});

	it.each([
		["story edited", "fit"],
		["story deleted", "answer"],
		["profile edited", "fit"],
		["fact switched off", "answer"],
	] as const)("rejects %s during in-flight %s generation", async (change, task) => {
		const remembered = await fact("alice", "I restored a failed service.");
		const original = await service.saveStory("alice", { ...story([remembered.id]), result: "Original story outcome" });
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		fixture.generate.mockImplementationOnce(async () => {
			started.resolve();
			await release.promise;
			return task === "answer"
				? { text: "Original story outcome", factIds: [remembered.id] }
				: {
						headline: "Original story outcome",
						summary: "",
						requirements: [],
						checks: [],
						ask: null,
						factIds: [remembered.id],
					};
		});
		const { generateCareer } = await import("./generate");
		const pending = generateCareer({
			userId: "alice",
			applicationId: "alice-app",
			locale: "en-US",
			task: task === "fit" ? { task } : { task, question: "Why you?", answer: "" },
		});
		await started.promise;
		if (change === "story edited")
			await service.saveStory("alice", { ...original.data, result: "Corrected outcome" }, original.id);
		else if (change === "story deleted") await service.deleteStory("alice", original.id);
		else if (change === "profile edited")
			await service.saveProfile("alice", careerProfileDataSchema.parse({ priorities: "Different priorities" }));
		else await service.updateFact("alice", { id: remembered.id, status: "excluded" });
		release.resolve();
		await expect(pending).rejects.toMatchObject({ code: "CONFLICT" });
		expect(await getDb().select().from(tables.careerArtifact)).toEqual([]);
	});

	it("does not reuse story claims after forgetting any supporting fact", async () => {
		const secret = "I reduced recovery time by 40 percent.";
		const remembered = await fact("alice", secret);
		const kept = await fact("alice", "I mentor engineers.");
		await service.saveStory("alice", { ...story([remembered.id, kept.id]), result: secret });
		await service.forgetFact("alice", remembered.id);
		const context = await service.context({ userId: "alice", applicationId: "alice-app" });
		expect(context.stories).toEqual([]);
		expect(JSON.stringify(context)).not.toContain(secret);
		expect(await service.stories({ userId: "alice" })).toMatchObject([{ data: { result: secret, factIds: [] } }]);
	});

	it("keeps a story usable when a fact is switched off and on, and drops it once the fact's text is corrected", async () => {
		const backing = await fact("alice", "I lead incident reviews.");
		const saved = await service.saveStory("alice", story([backing.id]));
		await service.updateFact("alice", { id: backing.id, status: "excluded" });
		expect((await service.context({ userId: "alice" })).stories).toEqual([]);
		await service.updateFact("alice", { id: backing.id, status: "active" });
		expect((await service.context({ userId: "alice" })).stories.map((item) => item.id)).toEqual([saved.id]);
		await service.updateFact("alice", { id: backing.id, text: "I lead weekly incident reviews." });
		expect((await service.context({ userId: "alice" })).stories).toEqual([]);
		// Saving the story again confirms it against the new text.
		await service.saveStory("alice", story([backing.id]), saved.id);
		expect((await service.context({ userId: "alice" })).stories.map((item) => item.id)).toEqual([saved.id]);
		// A corrected fact switched off and on later still backs the story it was confirmed for.
		await service.updateFact("alice", { id: backing.id, status: "excluded" });
		await service.updateFact("alice", { id: backing.id, status: "active" });
		expect((await service.context({ userId: "alice" })).stories.map((item) => item.id)).toEqual([saved.id]);
	});

	async function grouped(userId: string, text: string, group: string, applicationId: string | null = null) {
		const saved = await service.saveFact(userId, {
			applicationId,
			text,
			category: "experience",
			source: { kind: "manual", id: randomUUID(), quote: text },
			group,
		});
		if (!saved) throw new Error("Expected a new fact.");
		return saved;
	}

	it("switches a group with its subgroups, and starts new facts in it the same way", async () => {
		const acme = await grouped("alice", "I ran the Acme migration.", "experience/acme");
		const globex = await grouped("alice", "I led Globex reviews.", "experience/globex");
		const near = await grouped("alice", "I like experienced teams.", "experienced");
		const bobs = await grouped("bob", "Bob's experience.", "experience");
		expect(
			await service.setFactGroupStatus("alice", { group: "experience", status: "excluded", subgroups: true }),
		).toEqual({ updated: 2 });
		const status = async (userId: string) =>
			Object.fromEntries((await service.facts({ userId, all: true })).map((fact) => [fact.id, fact.status]));
		expect(await status("alice")).toEqual({ [acme.id]: "excluded", [globex.id]: "excluded", [near.id]: "active" });
		expect(await status("bob")).toEqual({ [bobs.id]: "active" });
		expect((await service.context({ userId: "alice" })).facts.map((fact) => fact.id)).toEqual([near.id]);

		// A new fact in a subgroup follows the group's last switch; switching again changes nothing already in place.
		const later = await grouped("alice", "I wrote Acme's runbooks.", "experience/acme/ops");
		expect(later.status).toBe("excluded");
		expect(
			await service.setFactGroupStatus("alice", { group: "experience", status: "excluded", subgroups: true }),
		).toEqual({ updated: 0 });

		// A subgroup switched on its own keeps that, until its parent is switched with subgroups again.
		await service.setFactGroupStatus("alice", { group: "experience/globex", status: "active", subgroups: true });
		expect((await grouped("alice", "Globex on-call.", "experience/globex")).status).toBe("active");
		await service.setFactGroupStatus("alice", { group: "experience", status: "excluded", subgroups: true });
		expect((await grouped("alice", "Globex rota.", "experience/globex")).status).toBe("excluded");

		const groups = await service.factGroups("alice");
		expect(groups.find((entry) => entry.group === "experience")).toMatchObject({ status: "excluded" });
		expect(groups.find((entry) => entry.group === "experience/globex")).toMatchObject({
			status: null,
			facts: { active: 0, excluded: 3 },
		});
		expect(groups.find((entry) => entry.group === "experienced")).toMatchObject({ facts: { active: 1, excluded: 0 } });
		expect((await service.exportData("alice")).factGroups.map((row) => row.group).sort()).toEqual([
			"experience",
			"experience/globex",
		]);
	});

	it("switches without subgroups, regroups and lists by group, and skips forgotten facts in bulk changes", async () => {
		const top = await grouped("alice", "Top-level fact.", "work");
		const nested = await grouped("alice", "Nested fact.", "work/acme");
		const loose = await fact("alice", "A fact in no group.");
		await service.setFactGroupStatus("alice", { group: "work", status: "excluded", subgroups: false });
		expect((await service.facts({ userId: "alice", group: "work" })).map((row) => [row.id, row.status])).toEqual([
			[nested.id, "active"],
			[top.id, "excluded"],
		]);
		await service.forgetFact("alice", top.id);
		expect(
			await service.updateFacts("alice", {
				ids: [top.id, nested.id, loose.id],
				group: "archive/old",
				status: "excluded",
			}),
		).toEqual({ updated: 2 });
		expect((await service.facts({ userId: "alice", group: "archive" })).map((row) => row.id).sort()).toEqual(
			[nested.id, loose.id].sort(),
		);
		// Another account's ids are never touched.
		expect(await service.updateFacts("bob", { ids: [nested.id], status: "active" })).toEqual({ updated: 0 });
		await service.updateFact("alice", { id: loose.id, group: null });
		expect((await service.facts({ userId: "alice" })).find((row) => row.id === loose.id)).toMatchObject({
			group: null,
			status: "excluded",
		});
	});

	it("keeps private groups from the AI unless an application includes them, without copying facts", async () => {
		const clearance = await grouped("alice", "I hold an active clearance.", "clearance");
		const level = await grouped("alice", "My clearance is at the top level.", "clearance/level");
		await service.updateFact("alice", { id: level.id, status: "excluded" });
		const acme = await grouped("alice", "I ran the Acme migration.", "experience/acme");
		const ids = async (applicationId: string | null) =>
			(await service.context({ userId: "alice", applicationId })).facts.map((fact) => fact.id).sort();
		const before = await service.context({ userId: "alice" });

		await service.saveFactGroup("alice", { group: "clearance", private: true });
		expect(await ids(null)).toEqual([acme.id]);
		expect(await ids("alice-app")).toEqual([acme.id]);
		// Making a group private changes what the AI may read, so in-flight work is discarded.
		expect((await service.context({ userId: "alice" })).memoryVersion).not.toBe(before.memoryVersion);
		await expect(service.saveStory("alice", story([clearance.id]))).rejects.toMatchObject({ code: "BAD_REQUEST" });
		const search = (await service.aiFacts({ userId: "alice", applicationId: null })).map((fact) => fact.id);
		expect(search).toEqual([acme.id]);
		expect((await service.factGroups("alice")).find((entry) => entry.group === "clearance")).toMatchObject({
			private: true,
		});

		// One application includes the group: switched-off facts in it come along; other applications don't change.
		const otherVersion = (await service.context({ userId: "alice", applicationId: "alice-other" })).version;
		const included = await service.saveOverride("alice", {
			applicationId: "alice-app",
			group: "clearance",
			mode: "include",
		});
		expect(await ids("alice-app")).toEqual([acme.id, clearance.id, level.id].sort());
		expect(await ids("alice-other")).toEqual([acme.id]);
		expect((await service.context({ userId: "alice", applicationId: "alice-other" })).version).toBe(otherVersion);
		const appStory = await service.saveStory("alice", story([clearance.id], "alice-app"));
		expect(
			(await service.context({ userId: "alice", applicationId: "alice-app" })).stories.map((item) => item.id),
		).toContain(appStory.id);

		// A fact override wins over its group's, and a new choice for a target replaces the old one.
		await service.saveOverride("alice", { applicationId: "alice-app", factId: level.id, mode: "exclude" });
		await service.saveOverride("alice", { applicationId: "alice-app", group: "experience", mode: "exclude" });
		expect(await ids("alice-app")).toEqual([clearance.id]);
		await service.saveOverride("alice", { applicationId: "alice-app", group: "experience", mode: "include" });
		expect((await service.overrides("alice", "alice-app")).map((row) => [row.group, row.factId, row.mode])).toEqual([
			["clearance", null, "include"],
			[null, level.id, "exclude"],
			["experience", null, "include"],
		]);
		await expect(
			service.saveOverride("alice", { applicationId: "alice-app", group: "x", factId: acme.id, mode: "include" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(service.overrides("bob", "alice-app")).rejects.toMatchObject({ code: "NOT_FOUND" });
		await service.deleteOverride("bob", included.id);
		expect(await service.overrides("alice", "alice-app")).toHaveLength(3);
		await service.deleteOverride("alice", included.id);
		expect(await ids("alice-app")).toEqual([acme.id]);

		// A correction to the shared fact is what the including application reads; nothing was copied.
		await service.saveOverride("alice", { applicationId: "alice-app", group: "clearance", mode: "include" });
		await service.updateFact("alice", { id: clearance.id, text: "I hold an active TS clearance." });
		expect(
			(await service.context({ userId: "alice", applicationId: "alice-app" })).facts.find(
				(fact) => fact.id === clearance.id,
			)?.text,
		).toBe("I hold an active TS clearance.");
		expect((await service.exportData("alice")).factOverrides).toHaveLength(3);
	});

	it("keeps AI limits per account and apart from preferences", async () => {
		const defaults = aiLimitsSchema.parse({});
		expect(await service.aiLimits("alice")).toEqual(defaults);
		expect(defaults).toMatchObject({
			actionTimeoutSeconds: 120,
			replyStepTimeoutSeconds: 120,
			replyTimeoutSeconds: 240,
			discoveryTimeoutSeconds: 90,
			webCallTimeoutSeconds: 20,
			transcriptionTimeoutSeconds: 60,
			speechTimeoutSeconds: 30,
		});
		const limits = aiLimitsSchema.parse({ coachFacts: 120, actionFactChars: 60_000 });
		// Saving limits before any preferences creates the profile with default preferences.
		await service.saveAiLimits("alice", limits);
		expect(await service.profile("alice")).toEqual(careerProfileDataSchema.parse({}));
		await service.saveProfile("alice", careerProfileDataSchema.parse({ priorities: "Autonomy" }));
		expect(await service.aiLimits("alice")).toEqual(limits);
		expect(await service.aiLimits("bob")).toEqual(defaults);
		const context = await service.context({ userId: "alice" });
		expect(context.limits).toEqual(limits);
		expect(context.profile).not.toHaveProperty("coachFacts");
		await service.saveAiLimits("alice", defaults);
		expect(await service.profile("alice")).toMatchObject({ priorities: "Autonomy" });
	});

	it("shares only as many facts and stories with the coach as the limits allow", async () => {
		const facts = [];
		for (const text of ["I lead incident reviews.", "I mentor engineers.", "I run the on-call rota."])
			facts.push(await fact("alice", text));
		await service.saveStory("alice", story([facts[0]?.id ?? ""]));
		await service.saveStory("alice", { ...story([facts[1]?.id ?? ""]), title: "Mentoring" });
		const { buildCareerInstructions } = await import("./tools");
		const shared = async () => {
			const context = await service.context({ userId: "alice" });
			const instructions = buildCareerInstructions({
				context,
				shareApplication: false,
				shareMemory: true,
				tab: undefined,
			});
			return {
				facts: context.facts.filter((item) => instructions.includes(item.text)).length,
				stories: context.stories.filter((item) => instructions.includes(item.data.title)).length,
			};
		};
		expect(await shared()).toEqual({ facts: 3, stories: 2 });
		await service.saveAiLimits("alice", aiLimitsSchema.parse({ coachFacts: 1, coachStories: 0 }));
		expect(await shared()).toEqual({ facts: 1, stories: 0 });
	});

	it("shares the facts and stories most relevant to the coach's message, not the newest", async () => {
		const rota = await fact("alice", "I run the on-call rota.");
		const mentor = await fact("alice", "I mentor engineers.");
		await fact("alice", "I lead incident reviews.");
		await service.saveStory("alice", { ...story([rota.id]), title: "Rebuilt the on-call rota" });
		await service.saveStory("alice", { ...story([mentor.id]), title: "Mentoring" });
		await service.saveAiLimits("alice", aiLimitsSchema.parse({ coachFacts: 1, coachStories: 1 }));
		const { buildCareerInstructions } = await import("./tools");
		const instructions = buildCareerInstructions({
			context: await service.context({ userId: "alice" }),
			shareApplication: false,
			shareMemory: true,
			tab: undefined,
			query: "How should I talk about running the rota?",
		});
		expect(instructions).toContain("I run the on-call rota.");
		expect(instructions).not.toContain("I lead incident reviews.");
		expect(instructions).toContain("Rebuilt the on-call rota");
		expect(instructions).not.toContain("Mentoring");
	});

	it("finds Knowledge matching any word of a coach search, best match first", async () => {
		await fact("alice", "I mentor engineers.");
		await fact("alice", "I run the on-call rota and mentor new joiners on it.");
		await fact("alice", "I lead incident reviews.");
		const { buildCareerTools } = await import("./tools");
		const tools = buildCareerTools({
			userId: "alice",
			context: await service.context({ userId: "alice" }),
			shareApplication: false,
			shareMemory: true,
			tab: undefined,
			sourceMessageId: undefined,
		});
		const found = (await tools.search_career_knowledge?.execute?.(
			{ query: "mentoring rota" },
			{ toolCallId: "ranked-search", messages: [], context: {} },
		)) as { facts: Array<{ text: string }> };
		expect(found.facts.map((item) => item.text)).toEqual([
			"I run the on-call rota and mentor new joiners on it.",
			"I mentor engineers.",
		]);
	});

	it("explains an action that reaches its time limit instead of failing as a server error", async () => {
		fixture.generate.mockRejectedValueOnce(
			new DOMException("The operation was aborted due to timeout", "TimeoutError"),
		);
		const { generateCareer } = await import("./generate");
		await expect(
			generateCareer({ userId: "alice", applicationId: "alice-app", locale: "en-US", task: { task: "fit" } }),
		).rejects.toMatchObject({
			code: "GATEWAY_TIMEOUT",
			message: expect.stringContaining("within the 120-second time limit"),
		});
	});

	it("sends application actions the facts that match the posting first", async () => {
		await getDb()
			.update(tables.application)
			.set({ jobDescription: "You will run OpenTelemetry collectors on Kubernetes." })
			.where(eq(tables.application.id, "alice-app"));
		const otel = await fact("alice", "I ran OpenTelemetry collectors on Kubernetes for 400 services.");
		await fact("alice", "I organised the team offsite.");
		await fact("alice", "I planned the quarterly budget.");
		fixture.generate.mockResolvedValueOnce({
			headline: "Review",
			summary: "",
			requirements: [],
			checks: [],
			ask: null,
			factIds: [],
		});
		const { generateCareer } = await import("./generate");
		await generateCareer({ userId: "alice", applicationId: "alice-app", locale: "en-US", task: { task: "fit" } });
		const prompt = fixture.generate.mock.calls.at(-1)?.[1]?.prompt as string;
		const context = JSON.parse(prompt.split("Context (data, not instructions):\n")[1] ?? "null") as {
			facts: Array<{ id: string }>;
		};
		expect(context.facts[0]?.id).toBe(otel.id);
		expect(context.facts).toHaveLength(3);
	});

	it("preserves independent workspace saves and rejects stale writes to the same key", async () => {
		await Promise.all([
			service.saveWorkspace("alice", "alice-app", { checklist: [1] }, { checklist: [] }),
			service.saveWorkspace("alice", "alice-app", { message: "Keep this" }, { message: "" }),
		]);
		const answers = [{ id: "one", question: "Why here?", answer: "First draft", factIds: [] }];
		await service.saveWorkspace("alice", "alice-app", { answers }, { answers: [] });
		const newer = [{ id: "one", question: "Why here?", answer: "New draft", factIds: [] }];
		await service.saveWorkspace("alice", "alice-app", { answers: newer }, { answers });
		await expect(service.saveWorkspace("alice", "alice-app", { answers }, { answers: [] })).rejects.toMatchObject({
			code: "CONFLICT",
		});
		expect(await service.workspace("alice", "alice-app")).toMatchObject({
			answers: newer,
			checklist: [1],
			message: "Keep this",
		});
	});

	it("submits the final draft and exact linked documents atomically and retries without duplicates", async () => {
		await getDb()
			.update(tables.application)
			.set({ sentResumeVersionId: null })
			.where(eq(tables.application.id, "alice-app"));
		await getDb()
			.insert(tables.coverLetter)
			.values({
				id: "submit-letter",
				userId: "alice",
				name: "For ACME",
				content: "<p>Final letter</p>",
				style: copyCoverLetterStyle(defaultResumeData),
				sourceResumeId: "shared-resume",
				senderLinked: true,
			});
		await getDb()
			.update(tables.application)
			.set({ coverLetterId: "submit-letter" })
			.where(eq(tables.application.id, "alice-app"));
		const answers = [{ id: "why", question: "Why ACME?", answer: "Final keystroke", factIds: [] }];
		await service.submitApplication("alice", "alice-app", answers, []);
		await service.submitApplication("alice", "alice-app", answers, []);
		const submitted = await applications.getById({ userId: "alice", id: "alice-app" });
		expect(submitted.status).toBe("applied");
		expect(submitted.activity.filter((entry) => entry.type === "stage" && entry.stage === "applied")).toHaveLength(1);
		if (!submitted.sentResumeVersionId || !submitted.sentCoverLetterVersionId)
			throw new Error("Missing submitted documents.");
		const [resume] = await getDb()
			.select()
			.from(tables.resumeVersion)
			.where(eq(tables.resumeVersion.id, submitted.sentResumeVersionId));
		const [letter] = await getDb()
			.select()
			.from(tables.coverLetterVersion)
			.where(eq(tables.coverLetterVersion.id, submitted.sentCoverLetterVersionId));
		expect(resume?.data.basics.headline).toBe("LIVE UNSUBMITTED DRAFT");
		expect(letter?.data).toMatchObject({
			content: "<p>Final letter</p>",
			style: { basics: { headline: "LIVE UNSUBMITTED DRAFT" } },
		});
		expect(await service.savedItems({ userId: "alice", applicationId: "alice-app", kind: "answers" })).toMatchObject([
			{ data: { answers }, outdated: false },
		]);
	});

	it("rejects a stale submit after another tab closes a never-submitted application", async () => {
		await applications.update({ userId: "alice", id: "alice-app", status: "closed", closedReason: "withdrew" });
		await expect(service.submitApplication("alice", "alice-app", [], [])).rejects.toMatchObject({ code: "CONFLICT" });
		const application = await applications.getById({ userId: "alice", id: "alice-app" });
		expect(application.status).toBe("closed");
		expect(application.activity.some((entry) => entry.type === "stage" && entry.stage === "applied")).toBe(false);
		expect(await service.savedItems({ userId: "alice", applicationId: "alice-app", kind: "answers" })).toEqual([]);
	});

	it("requires the immutable submission for a retry, while allowing soft-trashed live documents", async () => {
		const answers = [{ id: "why", question: "Why ACME?", answer: "Submitted text", factIds: [] }];
		await service.submitApplication("alice", "alice-app", answers, []);
		await getDb().update(tables.resume).set({ trashedAt: new Date() }).where(eq(tables.resume.id, "shared-resume"));
		await expect(service.submitApplication("alice", "alice-app", answers, [])).resolves.toBeUndefined();
		const [snapshot] = await service.savedItems({ userId: "alice", applicationId: "alice-app", kind: "answers" });
		if (!snapshot) throw new Error("Expected a submitted answer snapshot.");
		await service.deleteSavedItem("alice", snapshot.id);
		await expect(service.submitApplication("alice", "alice-app", answers, [])).rejects.toMatchObject({
			code: "CONFLICT",
		});
		expect((await applications.getById({ userId: "alice", id: "alice-app" })).status).toBe("applied");
		expect(await service.savedItems({ userId: "alice", applicationId: "alice-app", kind: "answers" })).toEqual([]);
	});

	it("rejects retries after a submitted document version is removed or the application moves on", async () => {
		await service.submitApplication("alice", "alice-app", [], []);
		await getDb().delete(tables.resumeVersion).where(eq(tables.resumeVersion.id, "sent-acme"));
		await expect(service.submitApplication("alice", "alice-app", [], [])).rejects.toMatchObject({ code: "CONFLICT" });
		await applications.update({ userId: "alice", id: "alice-app", status: "closed", closedReason: "withdrew" });
		await expect(service.submitApplication("alice", "alice-app", [], [])).rejects.toMatchObject({ code: "CONFLICT" });
		expect((await applications.getById({ userId: "alice", id: "alice-app" })).status).toBe("closed");
	});

	it("rolls submission back when a linked document cannot be snapshotted", async () => {
		await getDb()
			.update(tables.application)
			.set({ sentResumeVersionId: null })
			.where(eq(tables.application.id, "alice-app"));
		await getDb().update(tables.resume).set({ trashedAt: new Date() }).where(eq(tables.resume.id, "shared-resume"));
		const answers = [{ id: "why", question: "Why ACME?", answer: "Unsaved final text", factIds: [] }];
		await expect(service.submitApplication("alice", "alice-app", answers, [])).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		expect((await applications.getById({ userId: "alice", id: "alice-app" })).status).toBe("saved");
		expect((await service.workspace("alice", "alice-app")).answers).toEqual([]);
		expect(await service.savedItems({ userId: "alice", applicationId: "alice-app", kind: "answers" })).toEqual([]);
	});

	it("keeps chats visible if storage failure aborts application deletion", async () => {
		fixture.storageDelete.mockRejectedValueOnce(new Error("Synthetic storage failure"));
		await expect(applications.delete({ userId: "alice", id: "alice-app" })).rejects.toThrow(
			"Synthetic storage failure",
		);
		expect(await applications.getById({ userId: "alice", id: "alice-app" })).toHaveProperty("id", "alice-app");
		const [thread] = await getDb().select().from(tables.agentThread).where(eq(tables.agentThread.id, "alice-private"));
		expect(thread?.deletedAt).toBeNull();
	});

	it("does not apply an old stage proposal after the application moves on", async () => {
		await applications.update({ userId: "alice", id: "alice-app", status: "applied" });
		const reply = await savedItem("alice-app", {
			kind: "reply",
			message: "Interview invitation",
			title: "Interview",
			asks: [],
			unconfirmed: [],
			reply: "",
			changes: [{ type: "stage", stage: "interview" }],
			offer: null,
		});
		await applications.update({ userId: "alice", id: "alice-app", status: "offer" });
		await expect(service.applyReply("alice", reply.id, [0])).rejects.toMatchObject({ code: "CONFLICT" });
		expect((await applications.getById({ userId: "alice", id: "alice-app" })).status).toBe("offer");
	});

	it("discards a briefing when its schedule is paused while the provider runs", async () => {
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		fixture.generate.mockImplementationOnce(async () => {
			started.resolve();
			await release.promise;
			return {
				title: "Interview preparation",
				headline: "Prepare for ACME",
				summary: "",
				plan: [],
				questions: [],
				focus: "",
				opening: "",
				stories: [],
				honesty: "",
				storyIds: [],
				missingStory: null,
				practiceQuestions: [],
				factIds: [],
			};
		});
		await getDb()
			.insert(tables.careerSchedule)
			.values({
				id: "pause-me",
				userId: "alice",
				applicationId: "alice-app",
				interviewId: "alice-round",
				kind: "prepare",
				lead: "2h",
				enabled: true,
				nextRunAt: new Date(Date.now() - 60_000),
				timezone: "Europe/Berlin",
			});
		const { runCareerJobs, careerJobs } = await import("./jobs");
		const running = runCareerJobs();
		await started.promise;
		try {
			const { careerScheduleInputSchema } = await import("@reactive-resume/schema/career");
			const [schedule] = await careerJobs.list("alice");
			await careerJobs.save("alice", { ...careerScheduleInputSchema.parse(schedule), id: "pause-me", enabled: false });
		} finally {
			release.resolve();
			await running;
		}
		expect(await getDb().select().from(tables.careerArtifact)).toEqual([]);
		expect(await getDb().select().from(tables.careerNotification)).toEqual([]);
	});
	it("lists complete user history while bounding optional structured AI context", async () => {
		await getDb()
			.insert(tables.careerFact)
			.values(
				Array.from({ length: 205 }, (_, index) => ({
					userId: "alice",
					text: `Fact ${index}: ${"evidence ".repeat(180)}`,
					category: "accomplishment",
					source: { kind: "manual" as const, id: `source-${index}`, quote: "evidence" },
					sourceKey: `source-${index}`,
				})),
			);
		const facts = await service.facts({ userId: "alice" });
		expect(facts).toHaveLength(205);
		const supporting = facts[0];
		if (!supporting) throw new Error("Expected facts.");
		await getDb()
			.insert(tables.careerStory)
			.values(Array.from({ length: 105 }, () => ({ userId: "alice", data: story([supporting.id]) })));
		expect(await service.stories({ userId: "alice" })).toHaveLength(105);
		const { buildCareerTools } = await import("./tools");
		const tools = buildCareerTools({
			userId: "alice",
			context: await service.context({ userId: "alice", applicationId: "alice-app" }),
			shareApplication: true,
			shareMemory: true,
			tab: undefined,
			sourceMessageId: undefined,
		});
		const knowledge = await tools.search_career_knowledge?.execute?.(
			{ query: "" },
			{ toolCallId: "bounded-search", messages: [], context: {} },
		);
		expect(knowledge).toMatchObject({ truncated: true, hint: expect.stringContaining("Refine the query") });
		expect(JSON.stringify(knowledge).length).toBeLessThan(30_000);

		fixture.generate.mockResolvedValueOnce({
			headline: "Review",
			summary: "",
			requirements: [],
			checks: [],
			ask: null,
			factIds: [],
		});
		const { generateCareer } = await import("./generate");
		await generateCareer({ userId: "alice", applicationId: "alice-app", locale: "en-US", task: { task: "fit" } });
		const prompt = fixture.generate.mock.calls[0]?.[1]?.prompt as string;
		expect(prompt.length).toBeLessThan(50_000);
		expect(prompt).toContain("contextMayBeExcerpted");
	});
	it("prioritizes a selected older story and all its proof within the structured context budgets", async () => {
		const supportingIds = Array.from({ length: 30 }, (_, index) => `selected-proof-${index}`);
		await getDb()
			.insert(tables.careerFact)
			.values(
				supportingIds.map((id) => ({
					id,
					userId: "alice",
					text: `Proof ${id}: ${"\n".repeat(1400)}`,
					category: "accomplishment",
					source: { kind: "manual" as const, id, quote: "Proof" },
					sourceKey: id,
				})),
			);
		const selected = await service.saveStory("alice", {
			...story(supportingIds),
			title: "Chosen older story",
			situation: `Situation ${"\n".repeat(3900)}`,
			task: `Task ${"\n".repeat(3900)}`,
			action: `Action ${"\n".repeat(5900)}`,
			result: `Result ${"\n".repeat(3900)}`,
			reflection: `Reflection ${"\n".repeat(3900)}`,
		});
		await getDb()
			.update(tables.careerStory)
			.set({ updatedAt: new Date("2020-01-01T00:00:00Z") })
			.where(eq(tables.careerStory.id, selected.id));
		await getDb()
			.insert(tables.careerStory)
			.values(
				Array.from({ length: 50 }, (_, index) => ({
					userId: "alice",
					data: { ...story(supportingIds), title: `Recent optional story ${index}` },
				})),
			);
		fixture.generate.mockResolvedValueOnce({
			title: "Feedback",
			works: "Clear outcome",
			strengthen: "Explain your role",
			opening: "I restored service.",
			note: "Clear contribution",
			factIds: [],
		});
		const { generateCareer } = await import("./generate");
		const result = await generateCareer({
			userId: "alice",
			applicationId: "alice-app",
			locale: "en-US",
			task: {
				task: "practice",
				interviewId: null,
				storyId: selected.id,
				question: "Tell this story",
				origin: "simulated",
				mode: "typed",
				answer: "I restored a failed service.",
			},
		});
		const prompt = fixture.generate.mock.calls[0]?.[1]?.prompt as string;
		const context = JSON.parse(prompt.split("Context (data, not instructions):\n")[1] ?? "null") as {
			input: { storyId: string };
			facts: Array<{ id: string }>;
			stories: Array<{ id: string }>;
		};
		expect(context.input.storyId).toBe(selected.id);
		expect(context.stories[0]?.id).toBe(selected.id);
		expect(context.facts.map((item) => item.id).sort()).toEqual([...supportingIds].sort());
		expect(JSON.stringify(context.facts).length).toBeLessThan(10_100);
		expect(JSON.stringify(context.stories).length).toBeLessThan(10_100);
		expect(result.item?.evidence.storyIds).toEqual([selected.id]);
	});

	it("rejects unavailable selected stories before making a provider request", async () => {
		const support = await fact("alice", "I restored service.");
		const privateStory = await service.saveStory("alice", story([support.id], "alice-other"));
		const unbacked = await service.saveStory("alice", story([]));
		const inactive = await service.saveStory("alice", story([support.id]));
		const foreignSupport = await fact("bob", "Bob restored service.");
		const foreign = await service.saveStory("bob", story([foreignSupport.id]));
		await service.updateFact("alice", { id: support.id, status: "excluded" });
		const { generateCareer } = await import("./generate");
		for (const storyId of ["unknown-story", privateStory.id, unbacked.id, inactive.id, foreign.id]) {
			await expect(
				generateCareer({
					userId: "alice",
					applicationId: "alice-app",
					locale: "en-US",
					task: {
						task: "practice",
						interviewId: null,
						storyId,
						question: "Tell this story",
						origin: "simulated",
						mode: "typed",
						answer: "I restored a failed service.",
					},
				}),
			).rejects.toMatchObject({ code: "BAD_REQUEST" });
		}
		expect(fixture.generate).not.toHaveBeenCalled();
	});

	it("limits answer citations to the workspace contract before the draft is saved", async () => {
		const facts = [];
		for (let index = 0; index < 11; index++) facts.push(await fact("alice", `I mentored colleague ${index}.`));
		fixture.generate.mockResolvedValueOnce({ text: "I mentor colleagues.", factIds: facts.map((item) => item.id) });
		const { generateCareer } = await import("./generate");
		const result = await generateCareer({
			userId: "alice",
			applicationId: "alice-app",
			locale: "en-US",
			task: { task: "answer", question: "Why you?", answer: "" },
		});
		if (!result.answer) throw new Error("Expected an answer.");
		expect(result.answer.factIds).toHaveLength(10);
		const outputSchema = fixture.generate.mock.calls[0]?.[2] as { safeParse: (value: unknown) => { success: boolean } };
		expect(
			outputSchema.safeParse({ text: "I mentor colleagues.", factIds: facts.map((item) => item.id) }).success,
		).toBe(false);
		await service.saveWorkspace(
			"alice",
			"alice-app",
			{ answers: [{ id: "answer", question: "Why you?", answer: result.answer.text, factIds: result.answer.factIds }] },
			{ answers: [] },
		);
		expect((await service.workspace("alice", "alice-app")).answers[0]?.factIds).toHaveLength(10);
	});
	it.each(["resume deletion", "letter purge", "resume relink", "application deletion"] as const)(
		"orders %s before document locks when an application submission owns the application",
		async (operation) => {
			const { documentsService } = await import("../documents/service");
			const { resumeService } = await import("../resume/service");
			await getDb()
				.insert(tables.coverLetter)
				.values({
					id: "contended-letter",
					userId: "alice",
					name: "Contended",
					style: copyCoverLetterStyle(defaultResumeData),
					trashedAt: new Date(),
				});
			await getDb()
				.update(tables.application)
				.set({ coverLetterId: "contended-letter" })
				.where(eq(tables.application.id, "alice-app"));
			await getDb()
				.update(tables.resume)
				.set({ applicationId: "alice-app" })
				.where(eq(tables.resume.id, "shared-resume"));
			const editorPool = new Pool({ connectionString: databaseUrl, max: 1, options: `-c search_path=${schemaName}` });
			const editor = await editorPool.connect();
			let completion: Promise<{ error: unknown }> | undefined;
			try {
				const pid = (await pool.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]?.pid;
				await editor.query("BEGIN");
				await editor.query("SET LOCAL lock_timeout = '750ms'");
				await editor.query('SELECT id FROM "user" WHERE id = $1 FOR NO KEY UPDATE', ["alice"]);
				if (operation === "application deletion")
					await editor.query("SELECT id FROM resume WHERE id = 'shared-resume' FOR UPDATE");
				else await editor.query("SELECT id FROM application WHERE id = 'alice-app' FOR UPDATE");
				const work =
					operation === "application deletion"
						? applications.delete({ userId: "alice", id: "alice-app" })
						: operation === "resume deletion"
							? resumeService.delete({ userId: "alice", id: "shared-resume" })
							: operation === "letter purge"
								? documentsService.purge({ userId: "alice", type: "letter", id: "contended-letter" })
								: documentsService.linkApplication({
										userId: "alice",
										type: "resume",
										id: "shared-resume",
										applicationId: "alice-app",
									});
				completion = work.then(
					() => ({ error: null }),
					(error: unknown) => ({ error }),
				);
				await vi.waitFor(
					async () => {
						const blocked = await admin.query<{ wait_event_type: string }>(
							"SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
							[pid],
						);
						expect(blocked.rows[0]?.wait_event_type).toBe("Lock");
					},
					{ timeout: 2500, interval: 10 },
				);
				if (operation === "application deletion")
					await editor.query("SELECT id FROM application WHERE id = 'alice-app' FOR UPDATE");
				else if (operation === "letter purge")
					await editor.query("SELECT id FROM cover_letter WHERE id = 'contended-letter' FOR UPDATE");
				else await editor.query("SELECT id FROM resume WHERE id = 'shared-resume' FOR UPDATE");
				await editor.query("COMMIT");
				expect(await completion).toEqual({ error: null });
			} finally {
				await editor.query("ROLLBACK");
				editor.release();
				await completion;
				await editorPool.end();
			}
		},
	);

	it.each(["submission", "interview reschedule"] as const)(
		"keeps %s lock ordering compatible with concurrent document/job writes",
		async (operation) => {
			await getDb()
				.insert(tables.careerSchedule)
				.values({
					id: "contended-schedule",
					userId: "alice",
					applicationId: "alice-app",
					interviewId: "alice-round",
					kind: "prepare",
					enabled: true,
					lead: "2h",
					nextRunAt: new Date("2030-10-08T08:00:00Z"),
				});
			await getDb()
				.insert(tables.careerJob)
				.values({
					id: "contended-job",
					userId: "alice",
					scheduleId: "contended-schedule",
					dueAt: new Date("2030-10-08T08:00:00Z"),
					status: "running",
					lease: "editor",
					leaseUntil: new Date("2030-10-09T08:00:00Z"),
				});
			const editorPool = new Pool({ connectionString: databaseUrl, max: 1, options: `-c search_path=${schemaName}` });
			const editor = await editorPool.connect();
			let completion: Promise<{ error: unknown }> | undefined;
			try {
				const backend = await pool.query<{ pid: number }>("select pg_backend_pid() as pid");
				const pid = backend.rows[0]?.pid;
				await editor.query("BEGIN");
				await editor.query("SET LOCAL lock_timeout = '750ms'");
				if (operation === "submission")
					await editor.query("UPDATE application SET notes = 'Concurrent edit' WHERE id = 'alice-app'");
				else await editor.query("SELECT id FROM career_schedule WHERE id = 'contended-schedule' FOR UPDATE");
				const work =
					operation === "submission"
						? service.submitApplication("alice", "alice-app", [], [])
						: applications.updateInterview({
								userId: "alice",
								id: "alice-app",
								entryId: "alice-round",
								at: "2030-10-09T10:00:00Z",
							});
				completion = work.then(
					() => ({ error: null }),
					(error: unknown) => ({ error }),
				);
				await vi.waitFor(
					async () => {
						const blocked = await admin.query<{ wait_event_type: string }>(
							"SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
							[pid],
						);
						expect(blocked.rows[0]?.wait_event_type).toBe("Lock");
					},
					{ timeout: 2500, interval: 10 },
				);
				if (operation === "submission")
					await editor.query(
						"INSERT INTO resume_version (id, resume_id, user_id, kind, data) VALUES ($1, $2, $3, $4, $5)",
						["concurrent-sent", "shared-resume", "alice", "sent", JSON.stringify(resumeData("Concurrent version"))],
					);
				else await editor.query("UPDATE career_job SET error = 'Concurrent job write' WHERE id = 'contended-job'");
				await editor.query("COMMIT");
				expect(await completion).toEqual({ error: null });
			} finally {
				await editor.query("ROLLBACK");
				editor.release();
				await completion;
				await editorPool.end();
			}
		},
	);
});
