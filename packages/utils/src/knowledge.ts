import { terms } from "./relevance";

/**
 * Knowledge rules the API and the web app must agree on: how a fact or story is written into an application action,
 * when a story still holds, and how much of the AI limits the switched-on Knowledge uses.
 */

type FactShape = { id: string; text: string; category: string };
type Revision = { text: string; at: string };
type StoryData = {
	title: string;
	situation: string;
	task: string;
	action: string;
	result: string;
	reflection: string;
	factIds: readonly string[];
	tags: readonly string[];
	applicationId?: string | null | undefined;
};

/** A fact as application actions send it. */
export const promptFact = ({ id, text, category }: FactShape) => ({ id, text, category });

/** A story as application actions send it: its own words, without the fact ids behind it. */
export const promptStory = ({ id, data }: { id: string; data: StoryData }) => ({
	id,
	...data,
	factIds: undefined,
	applicationId: undefined,
});

/** Budgets are JSON characters, measured the way an action measures each item it adds. */
export const factPromptChars = (fact: FactShape) => JSON.stringify(promptFact(fact)).length;
export const storyPromptChars = (story: { id: string; data: StoryData }) => JSON.stringify(promptStory(story)).length;

/** When a fact's text last changed: its last correction, or never. Switching it on or off isn't a change. */
export const textChangedAt = (fact: { revisions: readonly Revision[] }) => new Date(fact.revisions.at(-1)?.at ?? 0);

/**
 * Whether a story can go to the AI: it rests on at least one fact, every one of them reaches the AI (`usable`, by id),
 * and none was corrected after the story was last saved.
 */
export const storyHolds = (
	story: { updatedAt: Date | string; data: { factIds: readonly string[] } },
	usable: ReadonlyMap<string, { revisions: readonly Revision[] }>,
) =>
	story.data.factIds.length > 0 &&
	story.data.factIds.every((id) => {
		const fact = usable.get(id);
		return fact !== undefined && textChangedAt(fact) <= new Date(story.updatedAt);
	});

/**
 * The rest of an action's context besides Knowledge, at most: posting 12,000 characters, requirements 6,000, notes
 * 3,000, contacts 3,000, resume 10,000 and cover letter 6,000 (career/generate.ts).
 */
export const ACTION_CONTEXT_CHARS = 40_000;

/** A rough token count for budgeting: about four characters a token in English JSON. */
export const estimateTokens = (chars: number) => Math.ceil(chars / 4);

type BudgetLimits = {
	coachFacts: number;
	coachStories: number;
	actionFactChars: number;
	actionStoryChars: number;
};

/**
 * How the switched-on Knowledge compares with the AI limits. `facts` and `stories` are what reaches the AI (switched
 * on, and for stories, still backed by switched-on facts); `contextTokens` is the model's window, when known.
 */
export function knowledgeBudget(input: {
	facts: readonly FactShape[];
	stories: readonly { id: string; data: StoryData }[];
	limits: BudgetLimits;
	contextTokens: number | null;
}) {
	const factChars = input.facts.reduce((sum, fact) => sum + factPromptChars(fact), 0);
	const storyChars = input.stories.reduce((sum, story) => sum + storyPromptChars(story), 0);
	// The largest prompt an action can send: each budget filled, plus the rest of its context.
	const actionChars = input.limits.actionFactChars + input.limits.actionStoryChars + ACTION_CONTEXT_CHARS;
	// What an action actually sends of this Knowledge: all of it, or as much as the budgets hold.
	const usedChars =
		Math.min(factChars, input.limits.actionFactChars) +
		Math.min(storyChars, input.limits.actionStoryChars) +
		ACTION_CONTEXT_CHARS;
	return {
		facts: { count: input.facts.length, chars: factChars, budget: input.limits.actionFactChars },
		stories: { count: input.stories.length, chars: storyChars, budget: input.limits.actionStoryChars },
		coach: {
			facts: { count: input.facts.length, limit: input.limits.coachFacts },
			stories: { count: input.stories.length, limit: input.limits.coachStories },
		},
		/** Some switched-on facts or stories don't fit an action: the best matches go first, the rest are left out. */
		overBudget: factChars > input.limits.actionFactChars || storyChars > input.limits.actionStoryChars,
		tokens: { used: estimateTokens(usedChars), budget: estimateTokens(actionChars), context: input.contextTokens },
		/** Full budgets would not fit the model's context window. */
		overContext: input.contextTokens !== null && estimateTokens(actionChars) > input.contextTokens,
	};
}
export type KnowledgeBudget = ReturnType<typeof knowledgeBudget>;

/** Whether a fact's group is the group or one of its subgroups (`experience/acme` is in `experience`). */
export const inGroup = (factGroup: string | null | undefined, group: string) =>
	factGroup === group || (factGroup?.startsWith(`${group}/`) ?? false);

/** The group and every group above it, nearest first: `a/b/c`, `a/b`, `a`. */
export const groupAncestors = (group: string) => {
	const parts = group.split("/");
	return parts.map((_, index) => parts.slice(0, parts.length - index).join("/"));
};

/** The setting that applies to a group: its own, else its nearest parent's that has one. */
export const nearestGroupSetting = <T>(group: string | null | undefined, settings: ReadonlyMap<string, T>) => {
	if (!group) return undefined;
	for (const ancestor of groupAncestors(group)) {
		const setting = settings.get(ancestor);
		if (setting !== undefined) return setting;
	}
	return undefined;
};

/** An application's exception for one group (with its subgroups) or one fact. */
export type KnowledgeOverride = { group: string | null; factId: string | null; mode: "include" | "exclude" };

/** What decides whether facts reach the AI, beyond their own switch: private groups, and in an application, its overrides. */
export type KnowledgeRules = { privateGroups: readonly string[]; overrides: readonly KnowledgeOverride[] };

export const NO_RULES: KnowledgeRules = { privateGroups: [], overrides: [] };

/**
 * Whether a fact reaches the AI. Forgotten and archived facts never do. Otherwise, in order: the application's
 * override for that fact, then its override for the fact's group or the nearest group above it, then a private group
 * (never), then the fact's own switch.
 */
export function reachesAi(
	fact: { id: string; status: string; group?: string | null | undefined },
	rules: KnowledgeRules = NO_RULES,
) {
	if (fact.status !== "active" && fact.status !== "excluded") return false;
	const own = rules.overrides.find((override) => override.factId === fact.id);
	if (own) return own.mode === "include";
	const byGroup = new Map(
		rules.overrides.flatMap((override) => (override.group ? [[override.group, override.mode] as const] : [])),
	);
	const mode = nearestGroupSetting(fact.group, byGroup);
	if (mode) return mode === "include";
	if (isPrivateGroup(fact.group, rules.privateGroups)) return false;
	return fact.status === "active";
}

/** Whether a group, or a group above it, is private. */
export const isPrivateGroup = (group: string | null | undefined, privateGroups: readonly string[]) =>
	Boolean(group) && privateGroups.some((entry) => inGroup(group, entry));

/** Text as duplicates compare it: case, accents, punctuation and spacing don't count. */
export const normalizeFactText = (text: string) =>
	text
		.toLocaleLowerCase()
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();

type DuplicateFact = { id: string; text: string; applicationId: string | null; status: string };

/** Two facts can duplicate each other when one would reach the other's scope: shared, or the same application. */
const sameScope = (a: DuplicateFact, b: DuplicateFact) =>
	a.applicationId === null || b.applicationId === null || a.applicationId === b.applicationId;

/** Near duplicates share this much of their words (Jaccard on stemmed terms), or one holds nearly all of the other's. */
const NEAR_OVERLAP = 0.75;
const NEAR_CONTAINED = 0.9;

/**
 * Exact duplicates (the same normalized text) and near duplicates (mostly the same words) among facts that are in use,
 * that is switched on or off but not archived or forgotten. Exact ones come as clusters, near ones as pairs with
 * their similarity (0 to 1), most similar first; a pair that's already exact isn't repeated as near.
 */
export function findDuplicates<T extends DuplicateFact>(facts: readonly T[]) {
	const live = facts.filter((fact) => fact.status === "active" || fact.status === "excluded");
	const byText = new Map<string, T[]>();
	for (const fact of live) {
		const key = normalizeFactText(fact.text);
		if (!key) continue;
		byText.set(key, [...(byText.get(key) ?? []), fact]);
	}
	const exact: T[][] = [];
	for (const cluster of byText.values()) {
		// Split by scope: copies private to two different applications don't reach each other.
		const shared = cluster.filter((fact) => fact.applicationId === null);
		const scopes = new Map<string, T[]>();
		for (const fact of cluster)
			if (fact.applicationId !== null)
				scopes.set(fact.applicationId, [...(scopes.get(fact.applicationId) ?? []), fact]);
		if (shared.length) {
			const all = [...shared, ...[...scopes.values()].flat()];
			if (all.length > 1) exact.push(all);
		} else for (const scoped of scopes.values()) if (scoped.length > 1) exact.push(scoped);
	}

	const termSets = live.map((fact) => new Set(terms(fact.text)));
	const index = new Map<string, number[]>();
	termSets.forEach((set, position) => {
		for (const term of set) index.set(term, [...(index.get(term) ?? []), position]);
	});
	const exactKey = new Map(live.map((fact) => [fact.id, normalizeFactText(fact.text)]));
	const near: { facts: [T, T]; similarity: number; contained: boolean }[] = [];
	const seen = new Set<string>();
	live.forEach((fact, position) => {
		const own = termSets[position];
		if (!own || own.size < 3) return;
		const shared = new Map<number, number>();
		for (const term of own)
			for (const other of index.get(term) ?? []) if (other > position) shared.set(other, (shared.get(other) ?? 0) + 1);
		for (const [other, common] of shared) {
			const otherFact = live[other];
			const otherSet = termSets[other];
			if (!otherFact || !otherSet || otherSet.size < 3 || !sameScope(fact, otherFact)) continue;
			if (exactKey.get(fact.id) === exactKey.get(otherFact.id)) continue;
			const overlap = common / (own.size + otherSet.size - common);
			const contained = common / Math.min(own.size, otherSet.size);
			if (overlap < NEAR_OVERLAP && !(contained >= NEAR_CONTAINED && Math.min(own.size, otherSet.size) >= 5)) continue;
			const key = [fact.id, otherFact.id].sort().join(":");
			if (seen.has(key)) continue;
			seen.add(key);
			near.push({
				facts: [fact, otherFact],
				similarity: Math.round(Math.max(overlap, contained) * 100) / 100,
				contained: overlap < NEAR_OVERLAP,
			});
		}
	});
	near.sort((a, b) => b.similarity - a.similarity);
	return { exact, near };
}

/** Which of several duplicates to keep: shared over private, switched on over off, then the oldest. */
export function preferredFact<T extends DuplicateFact & { createdAt: Date | string }>(facts: readonly T[]) {
	return [...facts].sort(
		(a, b) =>
			Number(a.applicationId !== null) - Number(b.applicationId !== null) ||
			Number(a.status !== "active") - Number(b.status !== "active") ||
			new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
	)[0];
}

/** Why a fact keeps a story from the AI. */
export type StoryIssue =
	| { factId: string; reason: "missing" | "off" | "private" | "archived" }
	| { factId: string; reason: "corrected"; before: string; after: string };

/**
 * Why a story can't go to the AI, fact by fact: a fact is gone, switched off, private, archived, or was corrected
 * after the story was saved (with its text then and now). Empty when the story is usable; a story with no facts at all
 * has one issue with an empty fact id.
 */
export function storyIssues(
	story: { updatedAt: Date | string; data: { factIds: readonly string[] } },
	facts: ReadonlyMap<
		string,
		{ id: string; text: string; status: string; group?: string | null; revisions: readonly Revision[] }
	>,
	rules: KnowledgeRules = NO_RULES,
): StoryIssue[] {
	if (story.data.factIds.length === 0) return [{ factId: "", reason: "missing" }];
	const saved = new Date(story.updatedAt);
	return story.data.factIds.flatMap((factId): StoryIssue[] => {
		const fact = facts.get(factId);
		if (!fact || fact.status === "forgotten") return [{ factId, reason: "missing" }];
		if (fact.status === "archived") return [{ factId, reason: "archived" }];
		if (!reachesAi(fact, rules))
			return [{ factId, reason: isPrivateGroup(fact.group, rules.privateGroups) ? "private" : "off" }];
		if (textChangedAt(fact) <= saved) return [];
		// Its text when the story was saved: the earliest correction made after that holds it.
		const before = fact.revisions.find((revision) => new Date(revision.at) > saved)?.text ?? "";
		return [{ factId, reason: "corrected", before, after: fact.text }];
	});
}
