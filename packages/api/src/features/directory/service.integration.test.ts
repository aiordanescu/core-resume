import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as tables from "@reactive-resume/db/schema";
import { contactSchema, interviewDetailsSchema } from "@reactive-resume/schema/applications/data";
import { contactFieldsSchema } from "@reactive-resume/schema/directory";
import { accountImportDto } from "../../dto/account-import";

const fixture = vi.hoisted(() => ({ db: undefined as ReturnType<typeof drizzle> | undefined }));
vi.mock("@reactive-resume/db/client", () => ({
	get db() {
		return fixture.db;
	},
}));
const databaseUrl = process.env.INTEGRATIONS_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

suite("Directory migration and account boundaries", () => {
	let admin: Pool;
	let pool: Pool;
	let service: (typeof import("./service"))["directoryService"];
	let applications: (typeof import("../applications/service"))["applicationService"];
	const schemaName = `directory_test_${randomUUID().replaceAll("-", "")}`;
	const userId = "directory-owner";
	const otherId = "directory-other";
	const getDb = () => {
		if (!fixture.db) throw new Error("Test database unavailable");
		return fixture.db;
	};

	beforeAll(async () => {
		if (!databaseUrl || new URL(databaseUrl).pathname !== "/rr_test")
			throw new Error("Directory tests require the isolated rr_test database.");
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
			const sql = await readFile(new URL(`${directory}/migration.sql`, migrations), "utf8");
			if (directory.endsWith("_directory")) {
				await getDb()
					.insert(tables.user)
					.values([
						{
							id: userId,
							name: "Owner",
							email: "directory-owner@example.test",
							username: "directory-owner",
							displayUsername: "Owner",
						},
						{
							id: otherId,
							name: "Other",
							email: "directory-other@example.test",
							username: "directory-other",
							displayUsername: "Other",
						},
					]);
				const contacts = [
					{ name: "Alice Example", role: "Engineer", type: "Referral", email: "alice@example.test", phone: "123" },
				];
				const duplicate = [
					{ name: " alice   example ", role: "Engineer", type: "Recruiter", email: "alice@work.test", phone: "456" },
				];
				const activity = [
					{
						id: "interview",
						type: "interview",
						at: "2026-10-20T18:00:00Z",
						...interviewDetailsSchema.parse({
							kind: "technical",
							participants: [{ name: "Alice Example", role: "Interviewer", profileUrl: "https://example.test/alice" }],
						}),
					},
				];
				for (const [id, owner, company, people, events] of [
					["legacy-1", userId, "Northstar Labs", contacts, activity],
					["legacy-2", userId, " \tnorthstar   labs \n", duplicate, []],
					["foreign", otherId, "Northstar Labs", contacts, []],
				] as const)
					await pool.query(
						"INSERT INTO application (id, user_id, company, role, contacts, activity) VALUES ($1,$2,$3,$4,$5,$6)",
						[id, owner, company, "Engineer", JSON.stringify(people), JSON.stringify(events)],
					);
			}
			await pool.query(sql.replaceAll('"public".', ""));
		}
		service = (await import("./service")).directoryService;
		applications = (await import("../applications/service")).applicationService;
	}, 60_000);
	afterAll(async () => {
		await pool?.end();
		await admin?.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
		await admin?.end();
	});

	it("migrates companies and merges people within an account and company, keeping all details and context roles", async () => {
		const companies = await service.companies({ userId });
		const people = await service.contacts({ userId });
		expect(companies).toHaveLength(1);
		expect(people).toHaveLength(1);
		const person = people[0];
		expect(person).toMatchObject({
			position: "Engineer",
			emails: expect.arrayContaining(["alice@example.test", "alice@work.test"]),
			phones: expect.arrayContaining(["123", "456"]),
			profileLinks: ["https://example.test/alice"],
		});
		const first = await applications.getById({ userId, id: "legacy-1" });
		const second = await applications.getById({ userId, id: "legacy-2" });
		expect(first.companyId).toBe(companies[0]?.id);
		expect(second.companyId).toBe(first.companyId);
		expect(first.contacts[0]).toMatchObject({ contactId: person?.id, type: "Referral" });
		expect(second.contacts[0]).toMatchObject({ contactId: person?.id, type: "Recruiter" });
		const detail = await service.contact({ userId, id: person?.id ?? "" });
		expect(detail.applications).toHaveLength(2);
		expect(detail.interviews[0]).toMatchObject({ contextRole: "Interviewer", entryId: "interview" });
		expect((await service.contacts({ userId: otherId }))[0]?.id).not.toBe(person?.id);
		await expect(service.contact({ userId: otherId, id: person?.id ?? "" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("uses central contacts across employers, preserves context, and records job changes without guessed dates", async () => {
		const agency = await service.createCompany({
			userId,
			name: "Atlas Recruiting",
			website: null,
			notes: "",
			sources: [],
		});
		const person = await service.createContact({
			userId,
			...contactFieldsSchema.parse({ name: "Jamie Example", companyId: agency.id, position: "Recruiter" }),
		});
		const id = await applications.create({
			userId,
			company: "Northstar Labs",
			role: "Lead",
			contacts: [contactSchema.parse({ contactId: person.id, name: "Stale name", type: "Recruiter" })],
		});
		const app = await applications.getById({ userId, id });
		expect(app.contacts[0]).toMatchObject({ contactId: person.id, name: person.name, type: "Recruiter" });
		await service.updateContact({
			userId,
			id: person.id,
			companyId: null,
			lookingForWork: true,
			name: "Jamie Newname",
		});
		const detail = await service.contact({ userId, id: person.id });
		expect(detail.employment[0]).toMatchObject({
			companyId: agency.id,
			companyName: agency.name,
			position: "Recruiter",
			startedOn: null,
			endedOn: null,
		});
		expect((await applications.getById({ userId, id })).contacts[0]?.name).toBe("Jamie Newname");
		expect(detail.applications).toHaveLength(1);
		await expect(
			service.createContact({
				userId: otherId,
				...contactFieldsSchema.parse({ name: "Bad link", companyId: agency.id }),
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			applications.create({
				userId: otherId,
				company: "Other",
				role: "Lead",
				contacts: [contactSchema.parse({ name: "Foreign", contactId: person.id })],
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(applications.getById({ userId: otherId, id })).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("creates central records from new application and interview entries, and erases links and private history on deletion", async () => {
		const id = await applications.create({
			userId,
			company: "Lumen",
			role: "Lead",
			contacts: [contactSchema.parse({ name: "Casey Example", type: "Referral", email: "casey@example.test" })],
		});
		await applications.addInterview({
			userId,
			id,
			at: "2026-10-25T18:00:00Z",
			...interviewDetailsSchema.parse({
				kind: "technical",
				participants: [{ name: "casey example", role: "Panelist" }],
			}),
		});
		const person = (await service.contacts({ userId, query: "Casey" }))[0];
		if (!person) throw new Error("Missing migrated contact");
		await service.addNote({ userId, id: person.id, text: "Met at a conference" });
		await service.updateContact({
			userId,
			id: person.id,
			position: "Director",
			lastContactedAt: new Date("2026-10-23T18:00:00Z"),
		});
		const detail = await service.contact({ userId, id: person.id });
		expect(detail.notes).toHaveLength(1);
		expect(detail.interviews).toHaveLength(1);
		expect(detail.interviews[0]?.contextRole).toBe("Panelist");
		await service.deleteContact({ userId, id: person.id });
		const app = await applications.getById({ userId, id });
		expect(app.contacts).toEqual([]);
		expect(app.activity.find((entry) => entry.type === "interview")).toMatchObject({ participants: [] });
		expect(await getDb().select().from(tables.contactNote).where(eq(tables.contactNote.contactId, person.id))).toEqual(
			[],
		);
		await applications.update({ userId, id, notes: "Still no contacts" });
		expect(await service.contacts({ userId, query: "Casey" })).toEqual([]);
	});

	it("exports and imports company, contact, history, note, and application links with new owned IDs", async () => {
		const { accountImportService } = await import("../account-import/service");
		const first = (await service.contacts({ userId }))[0];
		if (!first) throw new Error("Missing contact");
		await service.addNote({ userId, id: first.id, text: "Discussed the platform team" });
		await service.updateContact({ userId, id: first.id, position: "Engineering lead" });
		const source = await service.exportData(userId);
		const result = await accountImportService.run(
			otherId,
			accountImportDto.run.input.parse({ area: "directory", mode: "append", ...source }),
		);
		const oldContact = source.contacts[0];
		if (!oldContact) throw new Error("Missing exported contact");
		const mapped = result.ids.contact?.[oldContact.id];
		expect(mapped).toBeTruthy();
		expect(mapped).not.toBe(oldContact.id);
		const restored = await service.contact({ userId: otherId, id: mapped ?? "" });
		expect(restored.contact.name).toBe(oldContact.name);
		expect(restored.notes[0]?.text).toBe("Discussed the platform team");
		expect(restored.employment).toHaveLength(1);
		const apps = await getDb().select().from(tables.application).where(eq(tables.application.userId, userId));
		const imported = await accountImportService.run(
			otherId,
			accountImportDto.run.input.parse({ area: "applications", ids: result.ids, applications: apps }),
		);
		const legacy = await applications.getById({ userId: otherId, id: imported.ids.application?.["legacy-1"] ?? "" });
		expect(legacy.contacts[0]?.contactId).toBe(
			result.ids.contact?.[apps.find((row) => row.id === "legacy-1")?.contacts[0]?.contactId ?? ""],
		);
		expect(
			(await service.company({ userId: otherId, id: legacy.companyId ?? "" })).applications.some(
				(row) => row.id === legacy.id,
			),
		).toBe(true);
		// Forged maps never permit attaching an imported application to a different account's person.
		const forged = await accountImportService.run(
			otherId,
			accountImportDto.run.input.parse({
				area: "applications",
				ids: { contact: { forged: oldContact.id } },
				applications: [
					{
						id: "forged-app",
						company: "Test",
						role: "Lead",
						contacts: [contactSchema.parse({ name: "Someone else", contactId: "forged" })],
					},
				],
			}),
		);
		const safe = await applications.getById({ userId: otherId, id: forged.ids.application?.["forged-app"] ?? "" });
		expect(safe.contacts[0]?.contactId).not.toBe(oldContact.id);
	});
	it("imports reviewed connections, preserves manual fields, and refreshes application snapshots on reimport", async () => {
		const { importLinkedInContacts } = await import("./linkedin");
		const { linkedInConnectionSchema } = await import("@reactive-resume/schema/directory-import");
		const connection = linkedInConnectionSchema.parse({
			name: "Morgan Imported",
			profileUrl: "https://linkedin.com/in/morgan-imported",
			email: "morgan@example.test",
			company: "Orion Inc.",
			position: "Engineer",
			connectedOn: "2026-08-13",
		});
		const input = {
			importEmails: false,
			companies: [{ sourceName: "Orion Inc.", companyId: null, name: "Orion" }],
			rows: [{ connection, action: "create" as const }],
		};
		expect(await importLinkedInContacts(userId, input)).toMatchObject({ created: 1, companiesCreated: 1 });
		expect(await importLinkedInContacts(userId, input)).toMatchObject({ created: 0, skipped: 1 });
		const first = (await service.contacts({ userId, query: "Morgan Imported" }))[0];
		if (!first) throw new Error("Missing imported contact");
		expect(first.emails).toEqual([]);
		expect((await service.company({ userId, id: first.companyId ?? "" })).company.sources).toContainEqual({
			kind: "linkedin",
			id: "Orion Inc.",
		});
		await service.updateContact({
			userId,
			id: first.id,
			notes: "Keep my note",
			tags: ["conference"],
			phones: ["555-0101"],
			lookingForWork: true,
			lastContactedAt: new Date("2026-10-23T18:00:00Z"),
		});
		const appId = await applications.create({
			userId,
			company: "Different Company",
			role: "Lead",
			contacts: [contactSchema.parse({ contactId: first.id, name: first.name, type: "Referral" })],
		});
		const latest = (await service.contact({ userId, id: first.id })).contact;
		const updated = { ...connection, name: "Morgan Newname", company: "Vega LLC", position: "Director" };
		const change = {
			importEmails: true,
			companies: [{ sourceName: "Vega LLC", companyId: null, name: "Vega" }],
			rows: [
				{ connection: updated, action: "update" as const, contactId: first.id, expectedUpdatedAt: latest.updatedAt },
			],
		};
		expect(await importLinkedInContacts(userId, change)).toMatchObject({ updated: 1 });
		const detail = await service.contact({ userId, id: first.id });
		expect(detail.contact).toMatchObject({
			name: "Morgan Newname",
			emails: ["morgan@example.test"],
			notes: "Keep my note",
			phones: ["555-0101"],
			tags: ["conference"],
			lookingForWork: true,
			connectedOn: "2026-08-13",
			lastContactedAt: latest.lastContactedAt,
		});
		expect(detail.employment[0]).toMatchObject({
			companyName: "Orion",
			position: "Engineer",
			startedOn: null,
			endedOn: null,
		});
		expect((await applications.getById({ userId, id: appId })).contacts[0]).toMatchObject({
			name: "Morgan Newname",
			role: "Director",
			type: "Referral",
			email: "morgan@example.test",
		});
		await expect(importLinkedInContacts(userId, change)).rejects.toMatchObject({ code: "CONFLICT" });
		const blank = { ...updated, company: "", position: "", connectedOn: null, email: "" };
		expect(
			await importLinkedInContacts(userId, {
				importEmails: false,
				companies: [],
				rows: [
					{ connection: blank, action: "update", contactId: first.id, expectedUpdatedAt: detail.contact.updatedAt },
				],
			}),
		).toMatchObject({ unchanged: 1 });
		expect((await service.contact({ userId, id: first.id })).employment).toHaveLength(1);
	});
	it("requires explicit duplicate decisions, checks ownership, and rolls back a conflicting batch", async () => {
		const { importLinkedInContacts } = await import("./linkedin");
		const { linkedInConnectionSchema } = await import("@reactive-resume/schema/directory-import");
		const manual = await service.createContact({
			userId,
			...contactFieldsSchema.parse({ name: "Sam Duplicate", emails: ["manual@example.test"] }),
		});
		const connection = linkedInConnectionSchema.parse({
			name: manual.name,
			profileUrl: "https://linkedin.com/in/sam-duplicate",
			email: "new@example.test",
		});
		const create = { connection, action: "create" as const };
		await expect(
			importLinkedInContacts(userId, { importEmails: false, companies: [], rows: [create] }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(
			importLinkedInContacts(userId, {
				importEmails: false,
				companies: [],
				rows: [
					{
						...create,
						connection: { ...connection, name: "Should Roll Back", profileUrl: "https://www.linkedin.com/in/rollback" },
					},
					create,
				],
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(await service.contacts({ userId, query: "Should Roll Back" })).toEqual([]);
		await expect(
			importLinkedInContacts(otherId, {
				importEmails: false,
				companies: [],
				rows: [
					{
						connection,
						action: "update",
						contactId: manual.id,
						expectedUpdatedAt: manual.updatedAt,
						duplicateDecision: "merge",
					},
				],
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		const foreignCompany = (await service.companies({ userId: otherId }))[0];
		if (!foreignCompany) throw new Error("Missing other company");
		await expect(
			importLinkedInContacts(userId, {
				importEmails: false,
				companies: [{ sourceName: "Foreign", companyId: foreignCompany.id, name: foreignCompany.name }],
				rows: [{ ...create, connection: { ...connection, company: "Foreign" } }],
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(
			await importLinkedInContacts(userId, {
				importEmails: false,
				companies: [],
				rows: [
					{
						connection,
						action: "update",
						contactId: manual.id,
						expectedUpdatedAt: manual.updatedAt,
						duplicateDecision: "merge",
					},
				],
			}),
		).toMatchObject({ updated: 1 });
		expect((await service.contact({ userId, id: manual.id })).contact.emails).toEqual(["manual@example.test"]);
		const separate = { ...connection, profileUrl: "https://www.linkedin.com/in/sam-another" };
		expect(
			await importLinkedInContacts(userId, {
				importEmails: false,
				companies: [],
				rows: [{ connection: separate, action: "create", duplicateDecision: "separate" }],
			}),
		).toMatchObject({ created: 1 });
	});
	it("deletes all contacts only for the current account and keeps its applications and companies", async () => {
		const othersBefore = await service.contacts({ userId: otherId });
		const companiesBefore = await service.companies({ userId });
		await service.deleteAllContacts({ userId, confirm: true });
		expect(await service.contacts({ userId })).toEqual([]);
		expect(await service.contacts({ userId: otherId })).toEqual(othersBefore);
		expect(await service.companies({ userId })).toEqual(companiesBefore);
		const rows = await getDb().select().from(tables.application).where(eq(tables.application.userId, userId));
		expect(rows.length).toBeGreaterThan(0);
		expect(
			rows.every(
				(row) =>
					row.contacts.length === 0 &&
					row.activity.every((entry) => entry.type !== "interview" || entry.participants.length === 0),
			),
		).toBe(true);
	});
});
