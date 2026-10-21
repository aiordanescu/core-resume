import type { AccountArchive } from "./archive";
import { beforeEach, describe, expect, it, vi } from "vitest";

const importData = vi.hoisted(() => vi.fn());
vi.mock("@/libs/orpc/client", () => ({ client: { auth: { importData } } }));

const { importSteps, runAccountImport } = await import("./run");

const archive: AccountArchive = {
	source: "allthatwork",
	exportedAt: null,
	user: { resumePages: 2 },
	resumes: [{ id: "r1" }],
	letters: [
		{ id: "l1", sourceApplicationId: "a1" },
		{ id: "l2", sourceApplicationId: null },
	],
	applications: [{ id: "a1" }],
	career: {
		profile: null,
		aiLimits: { coachFacts: 40 },
		facts: [],
		factGroups: [],
		factOverrides: [],
		stories: [],
		artifacts: [],
		workspaces: [],
		opportunities: [],
		schedules: [],
		threads: [],
		messages: [],
		transcripts: [],
		attachments: [{ id: "x" }],
	},
};

beforeEach(() => {
	importData.mockReset();
});

describe("runAccountImport", () => {
	it("runs areas in dependency order and passes each area's new ids to the next", async () => {
		importData.mockImplementation(async (input: { area: string }) => ({
			ids:
				input.area === "documents"
					? { resume: { r1: "R1" } }
					: input.area === "applications"
						? { application: { a1: "A1" } }
						: {},
			added: { [input.area]: 1 },
			skipped: [],
			madePrivate: input.area === "documents" ? 1 : 0,
		}));
		const steps: string[] = [];
		const summary = await runAccountImport(
			archive,
			{ areas: { coach: "append", documents: "replace", applications: "append" }, settings: { aiLimits: true } },
			(step) => steps.push(step),
		);

		expect(steps).toEqual(["documents", "applications", "coach", "settings"]);
		const calls = importData.mock.calls.map(([input]) => input);
		expect(calls[0]).toMatchObject({ area: "documents", mode: "replace" });
		expect(calls[1]).toMatchObject({
			area: "applications",
			ids: { resume: { r1: "R1" } },
			letterLinks: [{ letterId: "l1", applicationId: "a1" }],
		});
		expect(calls[2]).toMatchObject({ area: "coach", ids: { resume: { r1: "R1" }, application: { a1: "A1" } } });
		expect(calls[3]).toEqual({ area: "settings", preferences: null, aiLimits: { coachFacts: 40 }, profile: null });
		expect(summary).toMatchObject({ madePrivate: 1, attachments: 1 });
	});

	it("stops at the first area that fails", async () => {
		importData.mockResolvedValueOnce({ ids: {}, added: {}, skipped: [], madePrivate: 0 });
		importData.mockRejectedValueOnce(new Error("boom"));
		await expect(
			runAccountImport(
				archive,
				{ areas: { documents: "append", knowledge: "append", coach: "append" }, settings: {} },
				() => {},
			),
		).rejects.toThrow("boom");
		expect(importData).toHaveBeenCalledTimes(2);
	});

	it("skips settings nobody chose", () => {
		expect(importSteps({ areas: {}, settings: { preferences: false } })).toEqual([]);
	});
});
