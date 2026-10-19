import { describe, expect, it } from "vitest";
import {
	ACTION_CONTEXT_CHARS,
	factPromptChars,
	groupAncestors,
	inGroup,
	knowledgeBudget,
	nearestGroupSetting,
	promptStory,
	reachesAi,
	storyHolds,
	storyPromptChars,
} from "./knowledge";

const fact = (id: string, text: string, revisions: { text: string; at: string }[] = []) => ({
	id,
	text,
	category: "accomplishment",
	revisions,
});
const story = (id: string, factIds: string[], updatedAt = "2026-10-10T00:00:00.000Z") => ({
	id,
	updatedAt,
	data: {
		applicationId: null,
		title: "Incident reviews",
		situation: "A service failed.",
		task: "Restore it.",
		action: "Led the review.",
		result: "",
		reflection: "",
		factIds,
		tags: ["reliability"],
	},
});
const limits = { coachFacts: 30, coachStories: 8, actionFactChars: 100, actionStoryChars: 400 };

describe("prompt shapes", () => {
	it("measures a fact and a story as an action writes them, without story fact ids", () => {
		const one = fact("f1", "I lead incident reviews.");
		expect(factPromptChars(one)).toBe(JSON.stringify({ id: "f1", text: one.text, category: "accomplishment" }).length);
		const written = JSON.stringify(promptStory(story("s1", ["f1"])));
		expect(written).not.toContain("factIds");
		expect(written).not.toContain("applicationId");
		expect(storyPromptChars(story("s1", ["f1"]))).toBe(written.length);
	});
});

describe("storyHolds", () => {
	const usable = new Map([
		["old", fact("old", "I run the rota.", [{ text: "I ran it.", at: "2026-10-01T00:00:00.000Z" }])],
		["new", fact("new", "I lead reviews.", [{ text: "I led them.", at: "2026-10-12T00:00:00.000Z" }])],
		["plain", fact("plain", "I mentor engineers.")],
	]);

	it("holds while every fact is usable and none was corrected after the story", () => {
		expect(storyHolds(story("s", ["old", "plain"]), usable)).toBe(true);
	});

	it("fails for a fact corrected after the story, one that isn't usable, or no facts at all", () => {
		expect(storyHolds(story("s", ["new"]), usable)).toBe(false);
		expect(storyHolds(story("s", ["plain", "gone"]), usable)).toBe(false);
		expect(storyHolds(story("s", []), usable)).toBe(false);
	});
});

describe("knowledgeBudget", () => {
	it("reports what fits, and what an action sends at most", () => {
		const budget = knowledgeBudget({
			facts: [fact("f1", "I lead incident reviews.")],
			stories: [],
			limits,
			contextTokens: 128_000,
		});
		expect(budget.overBudget).toBe(false);
		expect(budget.overContext).toBe(false);
		expect(budget.facts).toMatchObject({ count: 1, budget: 100 });
		expect(budget.tokens.budget).toBe(Math.ceil((100 + 400 + ACTION_CONTEXT_CHARS) / 4));
		expect(budget.tokens.used).toBe(Math.ceil((budget.facts.chars + ACTION_CONTEXT_CHARS) / 4));
	});

	it("flags Knowledge over the budget and budgets over the model's context window", () => {
		const facts = Array.from({ length: 5 }, (_, index) => fact(`f${index}`, "I lead incident reviews every week."));
		const budget = knowledgeBudget({ facts, stories: [], limits, contextTokens: 8000 });
		expect(budget.overBudget).toBe(true);
		// Over budget, an action still sends no more than the budget.
		expect(budget.tokens.used).toBe(Math.ceil((100 + ACTION_CONTEXT_CHARS) / 4));
		expect(budget.overContext).toBe(true);
		expect(knowledgeBudget({ facts, stories: [], limits, contextTokens: null }).overContext).toBe(false);
	});
});

describe("groups", () => {
	it("counts subgroups as part of a group, but not groups that only share a prefix", () => {
		expect(inGroup("experience/acme", "experience")).toBe(true);
		expect(inGroup("experience", "experience")).toBe(true);
		expect(inGroup("experienced", "experience")).toBe(false);
		expect(inGroup(null, "experience")).toBe(false);
	});

	it("lists a group's ancestors nearest first and applies the nearest setting", () => {
		expect(groupAncestors("a/b/c")).toEqual(["a/b/c", "a/b", "a"]);
		const settings = new Map([
			["a", "excluded"],
			["a/b/c", "active"],
		]);
		expect(nearestGroupSetting("a/b/c/d", settings)).toBe("active");
		expect(nearestGroupSetting("a/b", settings)).toBe("excluded");
		expect(nearestGroupSetting("z", settings)).toBeUndefined();
		expect(nearestGroupSetting(null, settings)).toBeUndefined();
	});
});

describe("reachesAi", () => {
	const on = { id: "on", status: "active", group: "experience/acme" };
	const off = { id: "off", status: "excluded", group: "clearance/ts" };
	const loose = { id: "loose", status: "active", group: null };

	it("follows each fact's switch without rules, and never sends forgotten or archived facts", () => {
		expect(reachesAi(on)).toBe(true);
		expect(reachesAi(off)).toBe(false);
		expect(reachesAi(loose)).toBe(true);
		expect(
			reachesAi(
				{ ...on, status: "forgotten" },
				{ privateGroups: [], overrides: [{ group: null, factId: "on", mode: "include" }] },
			),
		).toBe(false);
		expect(reachesAi({ ...on, status: "archived" })).toBe(false);
	});

	it("keeps private groups and their subgroups out, switched on or not", () => {
		const rules = { privateGroups: ["experience"], overrides: [] };
		expect(reachesAi(on, rules)).toBe(false);
		expect(reachesAi(loose, rules)).toBe(true);
	});

	it("lets an application include or exclude a group or a fact, the fact's own override first", () => {
		const rules = {
			privateGroups: ["clearance"],
			overrides: [
				{ group: "clearance", factId: null, mode: "include" as const },
				{ group: "experience", factId: null, mode: "exclude" as const },
				{ group: null, factId: "on", mode: "include" as const },
			],
		};
		// Included even though it's switched off and private.
		expect(reachesAi(off, rules)).toBe(true);
		// Its group is left out, but the fact itself is included.
		expect(reachesAi(on, rules)).toBe(true);
		expect(reachesAi({ id: "other", status: "active", group: "experience/globex" }, rules)).toBe(false);
	});

	it("uses the nearest group override", () => {
		const rules = {
			privateGroups: [],
			overrides: [
				{ group: "experience", factId: null, mode: "exclude" as const },
				{ group: "experience/acme", factId: null, mode: "include" as const },
			],
		};
		expect(reachesAi({ id: "x", status: "excluded", group: "experience/acme/ops" }, rules)).toBe(true);
		expect(reachesAi({ id: "y", status: "active", group: "experience/globex" }, rules)).toBe(false);
	});
});
