import type { WorkspaceTab } from "@reactive-resume/schema/career";
import { tool, type ToolSet } from "ai";
import { and, desc, eq } from "drizzle-orm";
import z from "zod";
import { careerSystemPromptTemplate } from "@reactive-resume/ai/prompts";
import { db } from "@reactive-resume/db/client";
import { application, careerArtifact } from "@reactive-resume/db/schema";
import { careerStoryInputSchema, factCategorySchema } from "@reactive-resume/schema/career";
import { coachQuery, rankByRelevance, relevanceScores, storyText, terms } from "@reactive-resume/utils/relevance";
import { careerService, modelFact } from "./service";

type CareerToolsInput = {
	userId: string;
	context: Awaited<ReturnType<typeof careerService.context>>;
	shareApplication: boolean;
	shareMemory: boolean;
	tab: WorkspaceTab | undefined;
	sourceMessageId: string | undefined;
	/** The message being answered; the facts and stories shared up front are the ones most relevant to it. */
	query?: string | undefined;
};

const TABS: Record<WorkspaceTab, string> = {
	fit: "checking how the role fits: its requirements against their evidence",
	apply: "writing answers for the application form",
	prepare: "preparing for the next interview round",
	practise:
		"practising interview answers: ask one question at a time and give feedback on the answer they actually gave",
	debrief: "writing down how a real interview went",
	messages: "reading and replying to messages from the employer",
	saved: "looking back at what was saved for this application",
};

const MEMORY = {
	ask: "When the latest user message states something lasting about them (experience, a skill, an accomplishment, a preference), call remember_fact with their exact words. The user sees it as a proposal and decides; never say it was saved.",
	auto: "When the latest user message states something lasting about them (experience, a skill, an accomplishment, a preference), call remember_fact with their exact words; it is saved to their Knowledge.",
	off: "Don't remember facts; the user switched memory off.",
};

/** Search results: only items sharing terms with the query, best match first. A query of only stopwords lists all. */
function search<T>(items: T[], text: (item: T) => string, query: string) {
	if (terms(query).length === 0) return items;
	const scores = relevanceScores(items, text, query);
	return items
		.map((item, index) => ({ item, score: scores[index] ?? 0 }))
		.filter(({ score }) => score > 0)
		.sort((a, b) => b.score - a.score)
		.map(({ item }) => item);
}

/** Tool responses cannot rely on history compaction: the latest turn must fit by itself. */
function boundedItems<T>(items: T[], budget: number) {
	let remaining = budget;
	const selected: T[] = [];
	for (const item of items) {
		const size = JSON.stringify(item).length;
		if (size > remaining) continue;
		selected.push(item);
		remaining -= size;
	}
	return { items: selected, truncated: selected.length < items.length };
}

export function buildCareerInstructions(
	input: Pick<CareerToolsInput, "context" | "shareApplication" | "shareMemory" | "tab" | "query"> & {
		offers?: Array<{ application: { company: string; role: string } | null; data: unknown }>;
	},
) {
	const { context } = input;
	const company = context.application?.company;
	// The web app records what a message shared from the same query (coach-thread.tsx), so keep the two in step.
	const query = coachQuery(input.query ?? "", input.shareApplication ? context.application : null);
	const task = context.application
		? `Help with this one application (${context.application.role} at ${company}). ${input.tab ? `The user is ${TABS[input.tab]}.` : ""}`
		: "Help with the whole search, across applications. Use list_opportunities to compare them.";
	const selected = {
		...(input.shareApplication
			? { application: context.application, resume: context.resume, letter: context.letter }
			: {}),
		...(input.shareMemory
			? {
					preferences: context.profile,
					facts: rankByRelevance(context.facts, (fact) => fact.text, query).slice(0, context.limits.coachFacts),
					stories: rankByRelevance(context.stories, (story) => storyText(story.data), query).slice(
						0,
						context.limits.coachStories,
					),
				}
			: {}),
		// Saved offers the user chose to compare: terms in their own currency and pay period.
		...(input.offers?.length
			? { offers: input.offers.map(({ application, data }) => ({ ...application, terms: data })) }
			: {}),
	};
	return careerSystemPromptTemplate
		.replace("{{TASK}}", task)
		.replace("{{MEMORY}}", input.shareMemory ? MEMORY[context.profile.memoryMode] : MEMORY.off)
		.replace("{{CONTEXT}}", JSON.stringify(selected));
}

export function buildCareerTools(input: CareerToolsInput): ToolSet {
	const scope = { userId: input.userId, applicationId: input.context.application?.id ?? null };
	const tools: ToolSet = {};
	if (input.shareApplication && input.shareMemory && scope.applicationId)
		tools.read_real_interview_history = tool({
			description: "Read the user's own debriefs of real interviews for this application. Practice is excluded.",
			inputSchema: z.object({}),
			execute: async () => {
				const rows = await db
					.select({ at: careerArtifact.createdAt, data: careerArtifact.data })
					.from(careerArtifact)
					.where(
						and(eq(careerArtifact.userId, input.userId), eq(careerArtifact.applicationId, scope.applicationId ?? "")),
					)
					.orderBy(desc(careerArtifact.createdAt))
					.limit(30);
				// Saved debriefs obey the same privacy cutoff as replayed chat messages.
				const cutoff = await careerService.memoryCutoff(input.userId);
				return rows.filter((row) => row.data.kind === "debrief" && (!cutoff || row.at > cutoff));
			},
		});
	if (input.shareMemory) {
		tools.search_career_knowledge = tool({
			description:
				"Find switched-on facts and STARR stories by keyword, best match first; any word in the query can match. Facts private to another application never appear.",
			inputSchema: z.object({ query: z.string().max(500) }),
			execute: async ({ query }) => {
				const active = (await careerService.facts(scope)).filter((fact) => fact.status === "active").map(modelFact);
				const facts = boundedItems(
					search(active, (fact) => fact.text, query),
					input.context.limits.searchFactChars,
				);
				const stories = boundedItems(
					search(input.context.stories, (story) => storyText(story.data), query),
					input.context.limits.searchStoryChars,
				);
				const truncated = facts.truncated || stories.truncated;
				return {
					facts: facts.items,
					stories: stories.items,
					truncated,
					hint: truncated
						? "Results are excerpts. Refine the query to find other supporting facts or stories; do not infer that omitted evidence is absent."
						: null,
				};
			},
		});
		tools.save_story = tool({
			description:
				"Save a STARR story the user agreed to, grounded in existing fact IDs. Leave Result or Reflection empty rather than inventing them.",
			inputSchema: careerStoryInputSchema
				.omit({ applicationId: true })
				.extend({ factIds: z.array(z.string()).min(1).max(30) }),
			execute: (story) =>
				careerService.saveStory(
					input.userId,
					{ ...story, applicationId: scope.applicationId },
					undefined,
					input.context.memoryVersion,
				),
		});
		const mode = input.context.profile.memoryMode;
		const sourceMessageId = input.sourceMessageId;
		if (sourceMessageId && mode !== "off")
			tools.remember_fact = tool({
				description:
					"Remember an explicit statement about the user (their experience, skills, accomplishments or preferences), quoted verbatim from their latest message. Never remember events in an application (an offer, a salary they were quoted, an interview time, what an employer said), hypotheticals, rewrites, generated text, mock answers or other people's claims.",
				inputSchema: z.object({ quote: z.string().trim().min(1).max(2000), category: factCategorySchema }),
				execute: async ({ quote, category }) => {
					const fact = {
						applicationId: scope.applicationId,
						text: quote,
						category,
						source: { kind: "user-message" as const, id: sourceMessageId, quote },
					};
					// Ask first: the reply shows the fact as a proposal; the user's Remember saves it.
					if (mode === "ask") return { status: "proposed" as const, fact };
					const saved = await careerService.saveFact(input.userId, fact, true);
					return saved ? { status: "saved" as const, fact, id: saved.id } : { status: "skipped" as const, fact };
				},
			});
	}
	if (!scope.applicationId && input.shareApplication)
		tools.list_opportunities = tool({
			description: "Read summaries of the user's applications for comparisons across their search.",
			inputSchema: z.object({}),
			execute: () =>
				db
					.select({
						id: application.id,
						company: application.company,
						role: application.role,
						status: application.status,
						location: application.location,
						salary: application.salary,
						requirements: application.requirements,
					})
					.from(application)
					.where(eq(application.userId, input.userId))
					.orderBy(desc(application.updatedAt))
					.limit(50),
		});
	return tools;
}
