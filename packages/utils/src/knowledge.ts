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
