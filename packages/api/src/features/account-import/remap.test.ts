import { describe, expect, it } from "vitest";
import { flattenIds, mapIdList, remapIds } from "./remap";

const ids = flattenIds({ fact: { "old-fact": "new-fact" }, artifact: { "old-item": "new-item" } });

describe("remapIds", () => {
	it("rewrites ids and prefixed ids anywhere in stored JSON, keeping keys and other text", () => {
		expect(
			remapIds(
				{
					answers: [{ id: "a1", factIds: ["old-fact", "unknown"], answer: "old-fact is mentioned here" }],
					evidence: { "old-fact": "old-fact" },
					ticks: { plan: ["plan:old-item", "now:interview-1"] },
					count: 3,
					empty: null,
				},
				ids,
			),
		).toEqual({
			answers: [{ id: "a1", factIds: ["new-fact", "unknown"], answer: "old-fact is mentioned here" }],
			evidence: { "old-fact": "new-fact" },
			ticks: { plan: ["plan:new-item", "now:interview-1"] },
			count: 3,
			empty: null,
		});
	});
});

describe("mapIdList", () => {
	it("keeps only ids that were imported", () => {
		expect(mapIdList(["old-fact", "gone", "old-item"], ids)).toEqual(["new-fact", "new-item"]);
	});
});
