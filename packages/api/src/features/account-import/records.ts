import z from "zod";
import {
	aiMetadataSchema,
	applicationClosedReasonSchema,
	applicationStatusSchema,
	applicationTimelineEntrySchema,
	contactSchema,
	postingSourceSchema,
} from "@reactive-resume/schema/applications/data";
import {
	careerSourceSchema,
	careerStoryInputSchema,
	careerWorkspaceSchema,
	factCategorySchema,
	savedItemDataSchema,
} from "@reactive-resume/schema/career";
import { coverLetterContentSchema } from "@reactive-resume/schema/cover-letter/data";

// One record of an "Export everything" archive, read leniently: exports come from older versions and from upstream
// Reactive Resume, so a field that's missing or no longer valid falls back to its default, and a record that still
// can't be read is skipped and counted, never fatal.

const id = z.string().min(1).max(64);
const optionalId = id.nullable().catch(null).default(null);
const stamp = z.coerce.date().optional().catch(undefined);
const nullableStamp = z.preprocess((value) => value ?? null, z.coerce.date().nullable()).catch(null);
const nullableText = (max: number) => z.string().max(max).nullable().catch(null).default(null);
const fileUrl = z
	.string()
	.refine((value) => /^(https?:\/\/|\/)/.test(value))
	.nullable()
	.catch(null)
	.default(null);
const tags = z.array(z.string().trim().min(1).max(100)).max(50).catch([]).default([]);

export const resumeRecord = z.object({
	id,
	name: z.string().trim().max(100).catch("").default(""),
	slug: z.string().max(200).catch("").default(""),
	// Upstream exports don't have it; their addresses come in as random ones.
	slugChosen: z.boolean().catch(false).default(false),
	tags,
	isPublic: z.boolean().catch(false).default(false),
	showDownloadButtons: z.boolean().catch(true).default(true),
	isLocked: z.boolean().catch(false).default(false),
	data: z.unknown(),
	createdAt: stamp,
	updatedAt: stamp,
});

export const letterRecord = coverLetterContentSchema.extend({
	id,
	sourceResumeId: optionalId,
	sourceApplicationId: optionalId,
	senderLinked: z.boolean().catch(false).default(false),
	designLinked: z.boolean().catch(false).default(false),
	isLocked: z.boolean().catch(false).default(false),
	tags,
	createdAt: stamp,
	updatedAt: stamp,
});

export const applicationRecord = z.object({
	companyId: z.string().nullable().optional(),
	id,
	company: z.string().trim().min(1).max(500),
	role: z.string().trim().min(1).max(500),
	location: nullableText(500),
	salary: nullableText(500),
	status: applicationStatusSchema.catch("saved").default("saved"),
	closedReason: applicationClosedReasonSchema.nullable().catch(null).default(null),
	resumeId: optionalId,
	coverLetterId: optionalId,
	sentCheckScore: z.number().int().min(0).max(100).nullable().catch(null).default(null),
	source: nullableText(500),
	tags,
	sourceUrl: fileUrl,
	jobDescription: nullableText(200_000),
	postingSource: postingSourceSchema.nullable().catch(null).default(null),
	requirements: z.array(z.string().max(2000)).max(200).catch([]).default([]),
	matchScore: z.number().int().min(0).max(100).nullable().catch(null).default(null),
	aiMetadata: aiMetadataSchema.nullable().catch(null).default(null),
	notes: nullableText(200_000),
	resumeFileUrl: fileUrl,
	resumeFileName: nullableText(500),
	coverLetterUrl: fileUrl,
	coverLetterName: nullableText(500),
	followUpAt: nullableStamp,
	followUpNote: nullableText(2000),
	contacts: z.array(contactSchema).max(200).catch([]).default([]),
	activity: z.array(applicationTimelineEntrySchema).max(2000).catch([]).default([]),
	appliedAt: stamp,
	createdAt: stamp,
	updatedAt: stamp,
});

export const workspaceRecord = z.object({ applicationId: id, data: careerWorkspaceSchema, updatedAt: stamp });

export const letterLink = z.object({ letterId: id, applicationId: id });

export const factRecord = z.object({
	id,
	applicationId: optionalId,
	text: z.string().max(20_000),
	category: factCategorySchema.catch("experience"),
	source: careerSourceSchema,
	sourceKey: z.string().min(1).max(200),
	status: z.enum(["active", "excluded", "archived", "forgotten"]).catch("active").default("active"),
	revisions: z
		.array(z.object({ text: z.string().max(20_000), at: z.string().max(64) }))
		.max(200)
		.catch([])
		.default([]),
	group: nullableText(500),
	createdAt: stamp,
	updatedAt: stamp,
});

export const factGroupRecord = z.object({
	group: z.string().trim().min(1).max(500),
	status: z.enum(["active", "excluded"]).nullable().catch(null).default(null),
	private: z.boolean().catch(false).default(false),
	createdAt: stamp,
	updatedAt: stamp,
});

export const factOverrideRecord = z.object({
	applicationId: id,
	group: nullableText(500),
	factId: optionalId,
	mode: z.enum(["include", "exclude"]),
	createdAt: stamp,
});

export const storyRecord = z.object({
	id,
	applicationId: optionalId,
	data: careerStoryInputSchema,
	createdAt: stamp,
	updatedAt: stamp,
});

export const artifactRecord = z.object({
	id,
	applicationId: optionalId,
	interviewId: nullableText(64),
	title: z.string().max(500),
	data: savedItemDataSchema,
	evidence: z
		.object({ factIds: z.array(z.string()).max(500), storyIds: z.array(z.string()).max(500) })
		.catch({ factIds: [], storyIds: [] }),
	inputVersion: z.string().max(200).catch("").default(""),
	createdAt: stamp,
	updatedAt: stamp,
});

export const opportunityRecord = z.object({
	url: z.string().min(1).max(4000),
	role: z.string().max(500).catch("").default(""),
	company: z.string().max(500).catch("").default(""),
	location: z.string().max(500).catch("").default(""),
	snippet: z.string().max(10_000).catch("").default(""),
	description: z.string().max(200_000).catch("").default(""),
	firstSeenAt: stamp,
	lastSeenAt: stamp,
	dismissedAt: nullableStamp,
	trackedApplicationId: optionalId,
	createdAt: stamp,
	updatedAt: stamp,
});

export const scheduleRecord = z.object({
	id,
	applicationId: optionalId,
	interviewId: nullableText(64),
	kind: z.enum(["discovery", "prepare", "follow-up"]),
	query: z.string().max(500).catch("").default(""),
	lead: z.enum(["24h", "2h", "morning"]).nullable().catch(null).default(null),
	locale: z.string().min(2).max(20).catch("en-US").default("en-US"),
	timezone: z.string().min(1).max(100).catch("UTC").default("UTC"),
	email: z.boolean().catch(false).default(false),
	nextRunAt: z.coerce.date(),
	intervalDays: z.number().int().min(1).max(30).nullable().catch(null).default(null),
	createdAt: stamp,
	updatedAt: stamp,
});

export const threadRecord = z.object({
	id,
	sourceResumeId: optionalId,
	workingResumeId: optionalId,
	coverLetterId: optionalId,
	scope: z.string().max(40).catch("document").default("document"),
	applicationId: optionalId,
	title: z.string().max(500).catch("").default(""),
	editsProposed: z.number().int().min(0).catch(0).default(0),
	editsAccepted: z.number().int().min(0).catch(0).default(0),
	status: z.string().max(40).catch("active").default("active"),
	reviewPatches: z.boolean().catch(false).default(false),
	lastMessageAt: stamp,
	archivedAt: nullableStamp,
	deletedAt: nullableStamp,
	createdAt: stamp,
	updatedAt: stamp,
});

export const messageRecord = z.object({
	threadId: id,
	role: z.string().min(1).max(40),
	status: z.string().max(40).catch("completed").default("completed"),
	sequence: z.number().int().min(0),
	uiMessage: z.record(z.string(), z.unknown()),
	error: nullableText(10_000),
	createdAt: stamp,
	updatedAt: stamp,
});

export const transcriptRecord = z.object({
	applicationId: optionalId,
	original: z.string().max(200_000),
	edited: z.string().max(200_000),
	model: z.string().max(200).catch("").default(""),
	createdAt: stamp,
	updatedAt: stamp,
});
