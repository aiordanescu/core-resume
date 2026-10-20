import z from "zod";
import {
	careerFactInputSchema,
	careerProfileDataSchema,
	careerScheduleInputSchema,
	careerScopeSchema,
	careerStoryInputSchema,
	careerWorkspaceSchema,
	knowledgeReviewSchema,
	factGroupSchema,
	factStatusSchema,
	factSwitchSchema,
	overrideModeSchema,
	generateTaskSchema,
	aiLimitsSchema,
} from "@reactive-resume/schema/career";
import { protectedProcedure } from "../../context";
import {
	careerFactOverrideSchema,
	careerFactSchema,
	careerNotificationSchema,
	careerOpportunitySchema,
	careerScheduleSchema,
	careerStorySchema,
	savedItemSchema,
} from "../../dto/career";
import { aiRequestRateLimit } from "../../middleware/rate-limit";
import { generateCareer } from "./generate";
import { joinInFlight } from "./in-flight";
import { careerJobs } from "./jobs";
import { knowledgeReview } from "./review";
import { careerService } from "./service";
import { careerVoiceRouter } from "./voice";

const id = z.object({ id: z.string().min(1) });
const applicationInput = z.object({ applicationId: z.string().min(1) });
const updatedOutput = z.object({ updated: z.number().int().describe("How many facts changed.") });
const factGroupOutput = z.object({
	group: z.string().nullable().describe("The group's path; null for facts in no group."),
	status: factSwitchSchema
		.nullable()
		.describe("How the group was last switched: new facts in it start this way. Null starts them switched on."),
	private: z
		.boolean()
		.describe("Its facts, and its subgroups', never reach the AI unless an application includes the group."),
	facts: z.object({ active: z.number().int(), excluded: z.number().int(), archived: z.number().int() }),
	activeChars: z
		.number()
		.int()
		.describe("JSON characters of its shared, switched-on facts, as the action budgets count them."),
});
const savedItemOutput = savedItemSchema.extend({
	application: z.object({ company: z.string(), role: z.string() }).nullable(),
	outdated: z.boolean(),
});

export const careerRouter = {
	voice: careerVoiceRouter,
	schedules: protectedProcedure
		.route({
			method: "GET",
			path: "/career/schedules",
			tags: ["Career"],
			operationId: "listCareerSchedules",
			summary: "List career schedules",
		})
		.input(z.object({}))
		.output(z.array(careerScheduleSchema))
		.handler(({ context }) => careerJobs.list(context.user.id)),
	saveSchedule: protectedProcedure
		.route({
			method: "POST",
			path: "/career/schedules",
			tags: ["Career"],
			operationId: "saveCareerSchedule",
			summary: "Save a career schedule",
		})
		.input(careerScheduleInputSchema.extend({ id: z.string().optional() }))
		.output(careerScheduleSchema)
		.handler(({ context, input }) => careerJobs.save(context.user.id, input)),
	deleteSchedule: protectedProcedure
		.route({
			method: "DELETE",
			path: "/career/schedules/{id}",
			tags: ["Career"],
			operationId: "deleteCareerSchedule",
			summary: "Delete a career schedule",
		})
		.input(id)
		.output(z.void())
		.handler(({ context, input }) => careerJobs.delete(context.user.id, input.id)),
	notifications: protectedProcedure
		.route({
			method: "GET",
			path: "/career/notifications",
			tags: ["Career"],
			operationId: "listCareerNotifications",
			summary: "List career notifications",
		})
		.input(z.object({}))
		.output(z.array(careerNotificationSchema))
		.handler(({ context }) => careerJobs.notifications(context.user.id)),
	markNotificationRead: protectedProcedure
		.route({
			method: "POST",
			path: "/career/notifications/{id}/read",
			tags: ["Career"],
			operationId: "readCareerNotification",
			summary: "Mark a career notification as read",
		})
		.input(id)
		.output(z.void())
		.handler(({ context, input }) => careerJobs.markRead(context.user.id, input.id)),
	opportunities: protectedProcedure
		.route({
			method: "GET",
			path: "/career/opportunities",
			tags: ["Career"],
			operationId: "listCareerOpportunities",
			summary: "List discovered opportunities",
		})
		.input(z.object({}))
		.output(z.array(careerOpportunitySchema))
		.handler(({ context }) => careerJobs.opportunities(context.user.id)),
	dismissOpportunity: protectedProcedure
		.route({
			method: "DELETE",
			path: "/career/opportunities/{id}",
			tags: ["Career"],
			operationId: "dismissCareerOpportunity",
			summary: "Dismiss a discovered opportunity",
		})
		.input(id)
		.output(z.void())
		.handler(({ context, input }) => careerJobs.dismissOpportunity(context.user.id, input.id)),
	trackOpportunity: protectedProcedure
		.route({
			method: "POST",
			path: "/career/opportunities/{id}/track",
			tags: ["Career"],
			operationId: "trackCareerOpportunity",
			summary: "Track a discovered opportunity",
			description: "Creates an application at Saved with the posting link, summary and the preferences it matched.",
		})
		.input(id)
		.output(applicationInput)
		.handler(({ context, input }) => careerService.trackOpportunity(context.user.id, input.id)),
	profile: protectedProcedure
		.route({
			method: "GET",
			path: "/career/profile",
			tags: ["Career"],
			operationId: "getCareerProfile",
			summary: "Get career preferences",
		})
		.input(z.object({}).optional())
		.output(careerProfileDataSchema)
		.handler(({ context }) => careerService.profile(context.user.id)),
	saveProfile: protectedProcedure
		.route({
			method: "PUT",
			path: "/career/profile",
			tags: ["Career"],
			operationId: "saveCareerProfile",
			summary: "Save career preferences",
		})
		.input(careerProfileDataSchema)
		.output(careerProfileDataSchema)
		.handler(({ context, input }) => careerService.saveProfile(context.user.id, input)),
	aiLimits: protectedProcedure
		.route({
			method: "GET",
			path: "/career/ai-limits",
			tags: ["Career"],
			operationId: "getAiLimits",
			summary: "Get AI limits",
			description:
				"How much Knowledge each AI request may carry and how long it may run: facts and stories the coach shares up front, what one coach knowledge search returns, the fact and story budgets of Fit, Apply, Prepare and the other application actions, and the time limits of those actions and of Coach and Assistant replies. Unset limits come back as their defaults.",
		})
		.input(z.object({}).optional())
		.output(aiLimitsSchema)
		.handler(({ context }) => careerService.aiLimits(context.user.id)),
	saveAiLimits: protectedProcedure
		.route({
			method: "PUT",
			path: "/career/ai-limits",
			tags: ["Career"],
			operationId: "saveAiLimits",
			summary: "Save AI limits",
			description:
				"Replaces every AI limit; omitted ones go back to their defaults. Character budgets are JSON characters and times are seconds. Larger Knowledge limits send more of your Knowledge to your AI provider and need a model with a larger context window; longer time limits suit slower models.",
		})
		.input(aiLimitsSchema)
		.output(aiLimitsSchema)
		.handler(({ context, input }) => careerService.saveAiLimits(context.user.id, input)),
	facts: protectedProcedure
		.route({
			method: "GET",
			path: "/career/facts",
			tags: ["Career"],
			operationId: "listCareerFacts",
			summary: "List career facts",
		})
		.input(
			careerScopeSchema.extend({
				query: z.string().max(500).optional(),
				all: z.boolean().optional().describe("Every fact, shared and private to any application."),
				group: factGroupSchema.optional().describe("Only facts in this group or a group under it."),
			}),
		)
		.output(z.array(careerFactSchema))
		.handler(({ context, input }) => careerService.facts({ userId: context.user.id, ...input })),
	saveFact: protectedProcedure
		.route({
			method: "POST",
			path: "/career/facts",
			tags: ["Career"],
			operationId: "saveCareerFact",
			summary: "Save a career fact",
		})
		.input(careerFactInputSchema)
		.output(careerFactSchema.omit({ usedBy: true, company: true }).nullable())
		.handler(({ context, input }) => careerService.saveFact(context.user.id, input)),
	updateFact: protectedProcedure
		.route({
			method: "PATCH",
			path: "/career/facts/{id}",
			tags: ["Career"],
			operationId: "updateCareerFact",
			summary: "Update a career fact",
		})
		.input(
			id.extend({
				text: z.string().trim().min(1).max(2000).optional(),
				status: factStatusSchema
					.optional()
					.describe("archived keeps the fact but hides it and never sends it; active or excluded restores it."),
				share: z.boolean().optional(),
				group: factGroupSchema
					.nullable()
					.optional()
					.describe("Moves the fact to this group; null takes it out of any."),
			}),
		)
		.output(z.void())
		.handler(async ({ context, input }) => {
			await careerService.updateFact(context.user.id, input);
		}),
	updateFacts: protectedProcedure
		.route({
			method: "PATCH",
			path: "/career/facts",
			tags: ["Career"],
			operationId: "updateCareerFacts",
			summary: "Switch or regroup several career facts",
			description:
				"Switches the listed facts on or off, moves them to a group, or both, in one change. Forgotten facts are skipped.",
		})
		.input(
			z.object({
				ids: z.array(z.string().min(1)).min(1).max(1000),
				status: factStatusSchema.optional(),
				group: factGroupSchema
					.nullable()
					.optional()
					.describe("Moves the facts to this group; null takes them out of any."),
			}),
		)
		.output(updatedOutput)
		.handler(({ context, input }) => careerService.updateFacts(context.user.id, input)),
	duplicates: protectedProcedure
		.route({
			method: "GET",
			path: "/career/facts/duplicates",
			tags: ["Career"],
			operationId: "listCareerFactDuplicates",
			summary: "Find duplicate career facts",
			description:
				"Exact duplicates (the same text, ignoring case, accents, punctuation and spacing) as sets with the fact to keep, and near duplicates (mostly the same words) as pairs with their similarity from 0 to 1. Only facts in use (switched on or off) count, and only within one scope: shared facts, or shared and one application's private facts.",
		})
		.input(z.object({}).optional())
		.output(
			z.object({
				exact: z.array(z.object({ keep: z.string(), copies: z.array(z.string()) })),
				near: z.array(
					z.object({
						factIds: z.array(z.string()),
						similarity: z.number(),
						contained: z
							.boolean()
							.describe("Matched because the longer fact holds nearly all of the shorter one's words."),
					}),
				),
				facts: z.array(
					z.object({
						id: z.string(),
						text: z.string(),
						applicationId: z.string().nullable(),
						company: z.string().nullable().describe("The application a private fact belongs to."),
						status: z.string(),
						group: z.string().nullable(),
					}),
				),
			}),
		)
		.handler(({ context }) => careerService.duplicates(context.user.id)),
	cleanDuplicates: protectedProcedure
		.route({
			method: "POST",
			path: "/career/facts/duplicates/clean",
			tags: ["Career"],
			operationId: "cleanCareerFactDuplicates",
			summary: "Remove application copies of shared facts",
			description:
				"Folds every word-for-word copy of a shared fact that sits in an application into the shared fact: its stories, saved items and overrides move over, the copy is archived, and the shared fact is included for that application if it wouldn't reach it otherwise. Copies among shared facts are left alone.",
		})
		.input(z.object({}).optional())
		.output(updatedOutput)
		.handler(({ context }) => careerService.cleanDuplicates(context.user.id)),
	mergeFact: protectedProcedure
		.route({
			method: "POST",
			path: "/career/facts/{id}/merge",
			tags: ["Career"],
			operationId: "mergeCareerFact",
			summary: "Merge a career fact into another",
			description:
				"Keeps the fact given as into and archives this one, which can be restored. This fact's stories, saved items and per-application overrides move to the one kept. If the one kept is private to an application and this one reached more applications, the one kept becomes shared, so no application loses it; it also takes this one's group if it has none. The one kept must not be archived.",
		})
		.input(id.extend({ into: z.string().min(1) }))
		.output(updatedOutput)
		.handler(({ context, input }) => careerService.mergeFact(context.user.id, input)),
	review: protectedProcedure
		.route({
			method: "GET",
			path: "/career/knowledge/review",
			tags: ["Career"],
			operationId: "getCareerKnowledgeReview",
			summary: "Get the last Knowledge review",
		})
		.input(z.object({}).optional())
		.output(knowledgeReviewSchema.nullable())
		.handler(({ context }) => knowledgeReview.get(context.user.id)),
	runReview: protectedProcedure
		.use(aiRequestRateLimit)
		.route({
			method: "POST",
			path: "/career/knowledge/review",
			tags: ["Career"],
			operationId: "runCareerKnowledgeReview",
			summary: "Review Knowledge with AI",
			description:
				"First removes application copies of shared facts, which needs no judgment. Then asks the default AI connection to flag facts that contradict each other, older figures a newer fact replaces, and claims with nothing to check them by, among the shared facts that reach the AI; private groups, switched-off and archived facts are never sent. Requests stay within the action budgets and time limit. Replaces the last review.",
		})
		.input(z.object({}).optional())
		.output(knowledgeReviewSchema)
		.handler(({ context, signal }) => knowledgeReview.run({ userId: context.user.id, ...(signal ? { signal } : {}) })),
	resolveFinding: protectedProcedure
		.route({
			method: "PATCH",
			path: "/career/knowledge/review/{id}",
			tags: ["Career"],
			operationId: "resolveCareerKnowledgeFinding",
			summary: "Mark a Knowledge review finding fixed or dismissed",
		})
		.input(id.extend({ resolved: z.enum(["fixed", "dismissed"]).nullable() }))
		.output(knowledgeReviewSchema)
		.handler(({ context, input }) => knowledgeReview.resolve(context.user.id, input)),
	factGroups: protectedProcedure
		.route({
			method: "GET",
			path: "/career/facts/groups",
			tags: ["Career"],
			operationId: "listCareerFactGroups",
			summary: "List career fact groups",
			description:
				"Every group that has facts or settings, and the facts in no group: how many are switched on and off, the size of the shared switched-on ones, and how each group was last switched. Groups are paths such as experience/acme; counts are per exact group, not including subgroups.",
		})
		.input(z.object({}).optional())
		.output(z.array(factGroupOutput))
		.handler(({ context }) => careerService.factGroups(context.user.id)),
	setFactGroupStatus: protectedProcedure
		.route({
			method: "POST",
			path: "/career/facts/groups/status",
			tags: ["Career"],
			operationId: "setCareerFactGroupStatus",
			summary: "Switch a career fact group on or off",
			description:
				"Switches every fact in the group on or off, and every group under it unless subgroups is false. Facts added to the group later start the same way. The group goes in the body because its path can contain slashes.",
		})
		.input(
			z.object({
				group: factGroupSchema,
				status: factSwitchSchema,
				subgroups: z.boolean().default(true).describe("Include every group under this one."),
			}),
		)
		.output(updatedOutput)
		.handler(({ context, input }) => careerService.setFactGroupStatus(context.user.id, input)),
	saveFactGroup: protectedProcedure
		.route({
			method: "PUT",
			path: "/career/facts/groups",
			tags: ["Career"],
			operationId: "saveCareerFactGroup",
			summary: "Make a career fact group private or not",
			description:
				"A private group's facts, subgroups included, never reach the AI provider, whatever their own switches say, unless an application includes the group (see PUT /career/overrides).",
		})
		.input(z.object({ group: factGroupSchema, private: z.boolean() }))
		.output(z.object({ group: z.string(), private: z.boolean() }))
		.handler(({ context, input }) => careerService.saveFactGroup(context.user.id, input)),
	overrides: protectedProcedure
		.route({
			method: "GET",
			path: "/career/overrides",
			tags: ["Career"],
			operationId: "listCareerFactOverrides",
			summary: "List an application's Knowledge overrides",
			description: "The groups and facts this application includes or excludes on top of the global switches.",
		})
		.input(applicationInput)
		.output(z.array(careerFactOverrideSchema))
		.handler(({ context, input }) => careerService.overrides(context.user.id, input.applicationId)),
	saveOverride: protectedProcedure
		.route({
			method: "PUT",
			path: "/career/overrides",
			tags: ["Career"],
			operationId: "saveCareerFactOverride",
			summary: "Include or exclude Knowledge for one application",
			description:
				"Includes a group (with its subgroups) or a fact for one application, even if it's switched off or private, or excludes one it would otherwise get. Nothing is copied. Give a group or a fact id, not both; a new choice for the same target replaces the old one. An override for a fact wins over one for its group.",
		})
		.input(
			applicationInput.extend({
				group: factGroupSchema.optional(),
				factId: z.string().min(1).optional(),
				mode: overrideModeSchema,
			}),
		)
		.output(careerFactOverrideSchema)
		.handler(({ context, input }) => careerService.saveOverride(context.user.id, input)),
	deleteOverride: protectedProcedure
		.route({
			method: "DELETE",
			path: "/career/overrides/{id}",
			tags: ["Career"],
			operationId: "deleteCareerFactOverride",
			summary: "Remove a Knowledge override",
		})
		.input(id)
		.output(z.void())
		.handler(({ context, input }) => careerService.deleteOverride(context.user.id, input.id)),
	forgetFact: protectedProcedure
		.route({
			method: "DELETE",
			path: "/career/facts/{id}",
			tags: ["Career"],
			operationId: "forgetCareerFact",
			summary: "Forget a career fact",
		})
		.input(id)
		.output(z.void())
		.handler(({ context, input }) => careerService.forgetFact(context.user.id, input.id)),
	stories: protectedProcedure
		.route({
			method: "GET",
			path: "/career/stories",
			tags: ["Career"],
			operationId: "listCareerStories",
			summary: "List career stories",
		})
		.input(careerScopeSchema)
		.output(z.array(careerStorySchema))
		.handler(({ context, input }) => careerService.stories({ userId: context.user.id, ...input })),
	saveStory: protectedProcedure
		.route({
			method: "POST",
			path: "/career/stories",
			tags: ["Career"],
			operationId: "saveCareerStory",
			summary: "Save a career story",
		})
		.input(careerStoryInputSchema.extend({ id: z.string().optional() }))
		.output(careerStorySchema)
		.handler(({ context, input: { id, ...input } }) => careerService.saveStory(context.user.id, input, id)),
	deleteStory: protectedProcedure
		.route({
			method: "DELETE",
			path: "/career/stories/{id}",
			tags: ["Career"],
			operationId: "deleteCareerStory",
			summary: "Delete a career story",
		})
		.input(id)
		.output(z.void())
		.handler(({ context, input }) => careerService.deleteStory(context.user.id, input.id)),
	savedItems: protectedProcedure
		.route({
			method: "GET",
			path: "/career/saved",
			tags: ["Career"],
			operationId: "listCareerSavedItems",
			summary: "List saved career work",
		})
		.input(
			z.object({
				applicationId: z.string().min(1).optional(),
				kind: z.enum(["fit", "briefing", "practice", "debrief", "answers", "reply", "offer"]).optional(),
			}),
		)
		.output(z.array(savedItemOutput))
		.handler(({ context, input }) => careerService.savedItems({ userId: context.user.id, ...input })),
	deleteSavedItem: protectedProcedure
		.route({
			method: "DELETE",
			path: "/career/saved/{id}",
			tags: ["Career"],
			operationId: "deleteCareerSavedItem",
			summary: "Delete saved career work",
		})
		.input(id)
		.output(z.void())
		.handler(({ context, input }) => careerService.deleteSavedItem(context.user.id, input.id)),
	generate: protectedProcedure
		.use(aiRequestRateLimit)
		.route({
			method: "POST",
			path: "/career/generate",
			tags: ["Career"],
			operationId: "generateCareerWork",
			summary: "Generate AI work for an application",
			description:
				"Asks the default AI connection for one structured piece of work for an application (fit check, briefing, practice feedback, debrief review, employer message, answer draft). Everything but answer drafts is saved.",
		})
		.input(applicationInput.extend({ locale: z.string().max(20).default("en-US"), task: generateTaskSchema }))
		.output(
			z.object({
				item: savedItemSchema.nullable(),
				answer: z.object({ text: z.string(), factIds: z.array(z.string()) }).nullable(),
			}),
		)
		// The same request from a second tab joins the run in progress rather than paying for a second one.
		.handler(({ context, input, signal }) =>
			joinInFlight(JSON.stringify([context.user.id, input.applicationId, input.locale, input.task]), signal, (shared) =>
				generateCareer({ userId: context.user.id, ...input, signal: shared }),
			),
		),
	applyReply: protectedProcedure
		.route({
			method: "POST",
			path: "/career/saved/{id}/apply",
			tags: ["Career"],
			operationId: "applyCareerReply",
			summary: "Apply suggested changes from a message",
		})
		.input(id.extend({ changes: z.array(z.number().int().min(0)).max(4) }))
		.output(z.void())
		.handler(({ context, input }) => careerService.applyReply(context.user.id, input.id, input.changes)),
	workspace: protectedProcedure
		.route({
			method: "GET",
			path: "/career/workspace/{applicationId}",
			tags: ["Career"],
			operationId: "getCareerWorkspace",
			summary: "Get an application workspace",
		})
		.input(applicationInput)
		.output(careerWorkspaceSchema)
		.handler(({ context, input }) => careerService.workspace(context.user.id, input.applicationId)),
	saveWorkspace: protectedProcedure
		.route({
			method: "PATCH",
			path: "/career/workspace/{applicationId}",
			tags: ["Career"],
			operationId: "saveCareerWorkspace",
			summary: "Save an application workspace",
		})
		.input(
			applicationInput
				.extend(careerWorkspaceSchema.partial().shape)
				.extend({ expected: careerWorkspaceSchema.partial() }),
		)
		.output(careerWorkspaceSchema)
		.handler(({ context, input: { applicationId, expected, ...patch } }) =>
			careerService.saveWorkspace(context.user.id, applicationId, patch, expected),
		),
	submitApplication: protectedProcedure
		.route({
			method: "POST",
			path: "/career/workspace/{applicationId}/submit",
			tags: ["Career"],
			operationId: "submitCareerApplication",
			summary: "Mark an application as submitted",
		})
		.input(
			applicationInput.extend({
				answers: careerWorkspaceSchema.shape.answers,
				expectedAnswers: careerWorkspaceSchema.shape.answers,
			}),
		)
		.output(z.void())
		.handler(({ context, input }) =>
			careerService.submitApplication(context.user.id, input.applicationId, input.answers, input.expectedAnswers),
		),
	snapshotAnswers: protectedProcedure
		.route({
			method: "POST",
			path: "/career/workspace/{applicationId}/answers",
			tags: ["Career"],
			operationId: "snapshotCareerAnswers",
			summary: "Save the answers sent with an application",
			description: "Saves the workspace's answers as sent, after the application is marked as applied.",
		})
		.input(applicationInput)
		.output(z.void())
		.handler(({ context, input }) => careerService.snapshotAnswers(context.user.id, input.applicationId)),
};
