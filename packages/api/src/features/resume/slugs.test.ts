import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({ insert: vi.fn(), delete: vi.fn() }));
vi.mock("@reactive-resume/db/client", () => ({ db: dbMock }));

const { randomSlug, recordSlugChange } = await import("./slugs");
const { isRandomSlug } = await import("@reactive-resume/utils/string");

beforeEach(() => {
	for (const mock of Object.values(dbMock)) mock.mockReset();
});

describe("recordSlugChange", () => {
	it("frees the new address from old redirects and keeps the old one for 30 days", async () => {
		const deleteWhere = vi.fn(async () => undefined);
		dbMock.delete.mockReturnValue({ where: deleteWhere });
		const onConflictDoUpdate = vi.fn(async () => undefined);
		const values = vi.fn((_input: { expiresAt: Date }) => ({ onConflictDoUpdate }));
		dbMock.insert.mockReturnValue({ values });

		await recordSlugChange(dbMock as never, { userId: "u1", resumeId: "r1", from: "old", to: "new" });

		expect(deleteWhere).toHaveBeenCalled();
		expect(values).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", resumeId: "r1", slug: "old" }));
		const expiresIn = (values.mock.calls[0]?.[0].expiresAt.getTime() ?? 0) - Date.now();
		expect(Math.round(expiresIn / (24 * 60 * 60 * 1000))).toBe(30);
		expect(onConflictDoUpdate).toHaveBeenCalled();
	});
});

describe("randomSlug", () => {
	it("makes addresses that pass the slug pattern, look random, and don't repeat", () => {
		const slugs = Array.from({ length: 500 }, randomSlug);
		for (const slug of slugs) {
			expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
			expect(isRandomSlug(slug)).toBe(true);
		}
		expect(new Set(slugs).size).toBe(slugs.length);
	});
});
