import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as tables from "@reactive-resume/db/schema";
import { isRandomSlug } from "@reactive-resume/utils/string";

const fixture = vi.hoisted(() => ({ db: undefined as ReturnType<typeof drizzle> | undefined }));
vi.mock("@reactive-resume/db/client", () => ({
	get db() {
		return fixture.db;
	},
}));

const databaseUrl = process.env.INTEGRATIONS_TEST_DATABASE_URL;

// Real PostgreSQL, opt-in only, in a schema of its own built from the shipped migrations.
describe.skipIf(!databaseUrl)("public addresses and old usernames", () => {
	let service: typeof import("./service").resumeService;
	let recordUsernameChange: typeof import("@reactive-resume/auth/username-redirect").recordUsernameChange;
	let admin: Pool;
	let pool: Pool;
	const schemaName = `address_test_${randomUUID().replaceAll("-", "")}`;
	const getDb = () => {
		if (!fixture.db) throw new Error("Test database is not initialized.");
		return fixture.db;
	};

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
			if (existsSync(file)) await pool.query((await readFile(file, "utf8")).replaceAll('"public".', ""));
		}
		service = (await import("./service")).resumeService;
		recordUsernameChange = (await import("@reactive-resume/auth/username-redirect")).recordUsernameChange;
	}, 30_000);

	afterAll(async () => {
		await pool?.end();
		await admin?.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
		await admin?.end();
	});

	beforeEach(async () => {
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
	});

	const create = (name: string, slug?: string) =>
		service.create({ userId: "alice", name, tags: [], locale: "en-US", ...(slug ? { slug } : {}) });
	const row = async (id: string) => {
		const [found] = await getDb().select().from(tables.resume).where(eq(tables.resume.id, id));
		if (!found) throw new Error("Expected the resume.");
		return found;
	};
	const visit = (username: string, slug: string) =>
		service.getBySlug({ username, slug, requestHeaders: new Headers(), requirePublic: true });

	it("gives new resumes a random address, unless one is given", async () => {
		const plain = await row(await create("Alexandru Stefan Iordanescu"));
		expect(isRandomSlug(plain.slug)).toBe(true);
		expect(plain.slugChosen).toBe(false);
		const chosen = await row(await create("Portfolio", "my-portfolio"));
		expect(chosen).toMatchObject({ slug: "my-portfolio", slugChosen: true });
	});

	it("swaps a name-made address for a random one on going public, leaving nothing that finds it", async () => {
		const id = await create("Old resume");
		// A resume from before random addresses, renamed once, with its older address still redirecting.
		await getDb().update(tables.resume).set({ slug: "alexandru-stefan-iordanescu-80" }).where(eq(tables.resume.id, id));
		await getDb()
			.insert(tables.resumeSlugRedirect)
			.values({
				userId: "alice",
				resumeId: id,
				slug: "alexandru-stefan-iordanescu-79",
				expiresAt: new Date(Date.now() + 86_400_000),
			});

		const updated = await service.update({ id, userId: "alice", isPublic: true });
		expect(isRandomSlug(updated.slug)).toBe(true);
		await expect(visit("alice", updated.slug)).resolves.toMatchObject({ id, username: "alice" });
		for (const old of ["alexandru-stefan-iordanescu-80", "alexandru-stefan-iordanescu-79"])
			await expect(visit("alice", old)).rejects.toMatchObject({ code: "NOT_FOUND" });

		// Off and on again keeps it; a fresh one on request replaces it outright.
		await service.update({ id, userId: "alice", isPublic: false });
		expect((await service.update({ id, userId: "alice", isPublic: true })).slug).toBe(updated.slug);
		const fresh = await service.update({ id, userId: "alice", randomSlug: true });
		expect(fresh.slug).not.toBe(updated.slug);
		await expect(visit("alice", updated.slug)).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("keeps an address the owner chose when the resume goes public", async () => {
		const id = await create("Portfolio");
		await service.update({ id, userId: "alice", slug: "my-portfolio" });
		expect((await service.update({ id, userId: "alice", isPublic: true })).slug).toBe("my-portfolio");
	});

	it("finds a resume by the owner's old username for 30 days, and a real account's username wins", async () => {
		const id = await create("Resume");
		const { slug } = await service.update({ id, userId: "alice", isPublic: true });
		await recordUsernameChange("alice", "alexandru");
		await getDb().update(tables.user).set({ username: "alexandru" }).where(eq(tables.user.id, "alice"));

		await expect(visit("alice", slug)).resolves.toMatchObject({ id, username: "alexandru" });
		await expect(visit("alexandru", slug)).resolves.toMatchObject({ id, username: "alexandru" });
		const [redirect] = await getDb().select().from(tables.usernameRedirect);
		expect(redirect).toMatchObject({ username: "alice", userId: "alice" });
		expect(Math.round(((redirect?.expiresAt.getTime() ?? 0) - Date.now()) / 86_400_000)).toBe(30);

		// Changing back frees the name from the redirect: it's the account's own again.
		await recordUsernameChange("alice", "alice");
		expect((await getDb().select().from(tables.usernameRedirect)).map((entry) => entry.username)).toEqual([
			"alexandru",
		]);
		await getDb().update(tables.user).set({ username: "alice" }).where(eq(tables.user.id, "alice"));

		// An expired redirect finds nothing.
		await getDb()
			.update(tables.usernameRedirect)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(tables.usernameRedirect.username, "alexandru"));
		await expect(visit("alexandru", slug)).rejects.toMatchObject({ code: "NOT_FOUND" });

		// Another account that takes a freed name gets its own links, not alice's.
		await getDb()
			.insert(tables.usernameRedirect)
			.values({ username: "bob", userId: "alice", expiresAt: new Date(Date.now() + 86_400_000) });
		await expect(visit("bob", slug)).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});
