import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	generate: vi.fn(),
	stored: [] as unknown[],
	facts: [] as unknown[],
	clean: vi.fn(),
}));
vi.mock("@reactive-resume/db/client", () => {
	const chain = {
		values: (values: { data: unknown }) => {
			mocks.stored.push(values.data);
			return { onConflictDoUpdate: async () => undefined };
		},
	};
	return { db: { insert: () => chain } };
});
vi.mock("../applications/ai", () => ({ generateJson: mocks.generate }));
vi.mock("../ai/service", () => ({ getModel: () => ({}) }));
vi.mock("../ai-providers/service", () => ({
	aiProvidersService: {
		getDefaultRunnable: async () => ({
			id: "p",
			label: "Test connection",
			provider: "openai",
			model: "m",
			apiKey: "k",
			reasoning: null,
		}),
	},
}));
vi.mock("./service", () => ({
	careerService: {
		cleanDuplicates: mocks.clean,
		aiLimits: async () => ({ actionFactChars: 2000, actionStoryChars: 2000, actionTimeoutSeconds: 120 }),
		aiFacts: async () => mocks.facts,
	},
}));

const { knowledgeReview, reviewBatches } = await import("./review");

const fact = (id: string, text: string, group: string | null = null, applicationId: string | null = null) => ({
	id,
	text,
	group,
	applicationId,
	status: "active",
	createdAt: new Date("2026-10-01T00:00:00Z"),
});

describe("review batches", () => {
	it("keeps groups together, fits each request in the budget and stops at the request cap", () => {
		const facts = [
			fact("b1", "x".repeat(50), "b"),
			fact("a1", "x".repeat(50), "a"),
			fact("loose", "x".repeat(50)),
			fact("a2", "x".repeat(50), "a"),
		];
		const { batches, skipped } = reviewBatches(facts, 220);
		// Groups in order, ungrouped facts last, packed into as few requests as fit.
		expect(batches.map((batch) => batch.map((item) => item.id))).toEqual([
			["a1", "a2"],
			["b1", "loose"],
		]);
		expect(skipped).toBe(0);
		const capped = reviewBatches(facts, 220, 1);
		expect(capped.batches.map((batch) => batch.map((item) => item.id))).toEqual([["a1", "a2"]]);
		expect(capped.skipped).toBe(2);
	});
});

describe("Knowledge review", () => {
	beforeEach(() => {
		mocks.generate.mockReset();
		mocks.clean.mockReset().mockResolvedValue({ updated: 3 });
		mocks.stored.length = 0;
		mocks.facts = [
			fact("old", "Team of 8 in 2023.", "work"),
			fact("new", "Team of 12 in 2025.", "work"),
			fact("claim", "Cut costs by 40 percent."),
			fact("private-copy", "Private to one application.", null, "app"),
		];
	});

	it("cleans copies first, sends only shared facts, and keeps findings that cite facts it sent", async () => {
		mocks.generate.mockResolvedValue({
			findings: [
				{ kind: "superseded", factIds: ["old", "new"], note: "The team grew.", keep: "new" },
				{ kind: "unsupported", factIds: ["claim"], note: "No date or place.", keep: "claim" },
				// Invented ids and a contradiction with one real fact are dropped.
				{ kind: "contradiction", factIds: ["old", "made-up"], note: "?", keep: null },
				{ kind: "unsupported", factIds: ["private-copy"], note: "Never sent.", keep: null },
			],
		});
		const review = await knowledgeReview.run({ userId: "alice" });
		expect(mocks.clean).toHaveBeenCalledWith("alice");
		const prompt = String(mocks.generate.mock.calls[0]?.[1]?.prompt);
		expect(prompt).toContain("Team of 8 in 2023.");
		expect(prompt).not.toContain("Private to one application.");
		expect(review).toMatchObject({ connection: "Test connection", reviewed: 3, total: 3, cleaned: 3 });
		expect(review.findings.map(({ kind, factIds, keep, resolved }) => ({ kind, factIds, keep, resolved }))).toEqual([
			{ kind: "superseded", factIds: ["old", "new"], keep: "new", resolved: null },
			{ kind: "unsupported", factIds: ["claim"], keep: null, resolved: null },
		]);
		expect(mocks.stored).toEqual([review]);
	});

	it("explains a review that reaches the time limit", async () => {
		mocks.generate.mockRejectedValue(new DOMException("timed out", "TimeoutError"));
		await expect(knowledgeReview.run({ userId: "alice" })).rejects.toMatchObject({ code: "GATEWAY_TIMEOUT" });
		expect(mocks.stored).toEqual([]);
	});
});
