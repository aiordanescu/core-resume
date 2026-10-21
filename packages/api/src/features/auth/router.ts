import { ORPCError } from "@orpc/server";
import { APIError } from "better-auth";
import { createSelectSchema } from "drizzle-zod";
import z from "zod";
import { accountAuth, auth } from "@reactive-resume/auth/config";
import * as schema from "@reactive-resume/db/schema";
import {
	aiLimitsSchema,
	careerProfileDataSchema,
	careerWorkspaceSchema,
	knowledgeReviewSchema,
} from "@reactive-resume/schema/career";
import { coverLetterSchema } from "@reactive-resume/schema/cover-letter/data";
import { APP_NAME } from "@reactive-resume/utils/brand";
import { timezoneSchema } from "@reactive-resume/utils/timezone";
import { protectedProcedure, publicProcedure } from "../../context";
import { accountImportDto } from "../../dto/account-import";
import { applicationDto } from "../../dto/application";
import {
	savedItemSchema,
	careerFactSchema,
	careerNotificationSchema,
	careerScheduleSchema,
	careerStorySchema,
} from "../../dto/career";
import { resumeDto } from "../../dto/resume";
import { accountRateLimit } from "../../middleware/rate-limit";
import { accountImportService } from "../account-import/service";
import { authService } from "./service";

const accountProcedure = protectedProcedure.use(accountRateLimit).use(async ({ next }) => {
	try {
		return await next();
	} catch (error) {
		if (error instanceof APIError && error.statusCode < 500) {
			throw new ORPCError(error.body?.code ?? "BAD_REQUEST", {
				status: error.statusCode,
				message: error.message,
				cause: error,
			});
		}
		throw error;
	}
});

export const authRouter = {
	getProfile: accountProcedure
		.route({
			method: "GET",
			path: "/auth/profile",
			tags: ["Authentication"],
			operationId: "getProfile",
			summary: "Get your profile",
			description: "Returns only the authenticated user's profile and timezone. No secrets are included.",
		})
		.input(z.object({}).optional())
		.output(
			createSelectSchema(schema.user).pick({
				id: true,
				name: true,
				username: true,
				displayUsername: true,
				image: true,
				email: true,
				emailVerified: true,
				timezone: true,
			}),
		)
		.handler(({ context }) => authService.getProfile(context.user.id)),

	updateProfile: accountProcedure
		.route({
			method: "PATCH",
			path: "/auth/profile",
			tags: ["Authentication"],
			operationId: "updateProfile",
			summary: "Update your profile",
			description:
				"Updates only the authenticated user's name, username, image, or timezone. Usernames must be unique.",
		})
		.input(
			z.object({
				name: z.string().trim().min(1).max(64).optional(),
				username: z
					.string()
					.trim()
					.min(3)
					.max(64)
					.regex(/^[a-z0-9._-]+$/)
					.optional(),
				image: z.url().nullable().optional(),
				timezone: timezoneSchema.optional(),
			}),
		)
		.output(z.object({ status: z.boolean() }))
		.handler(({ context, input }) =>
			accountAuth.updateProfile(context.user, {
				...(input.name !== undefined ? { name: input.name } : {}),
				...(input.username !== undefined ? { username: input.username } : {}),
				...(input.image !== undefined ? { image: input.image } : {}),
				...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
			}),
		),

	apiKeys: {
		list: accountProcedure
			.route({
				method: "GET",
				path: "/auth/api-keys",
				tags: ["Authentication"],
				operationId: "listApiKeys",
				summary: "List your API keys",
				description: "Lists only the authenticated user's API-key metadata. Key secrets are never returned.",
			})
			.input(z.object({}).optional())
			.output(
				z.object({
					apiKeys: z.array(
						createSelectSchema(schema.apikey)
							.pick({
								id: true,
								name: true,
								start: true,
								prefix: true,
								enabled: true,
								createdAt: true,
								updatedAt: true,
								expiresAt: true,
								lastRequest: true,
							})
							.extend({ permissions: z.record(z.string(), z.array(z.string())).nullable() }),
					),
					total: z.number(),
				}),
			)
			.handler(({ context }) => accountAuth.listApiKeys(context.user)),

		delete: accountProcedure
			.route({
				method: "DELETE",
				path: "/auth/api-keys/{keyId}",
				tags: ["Authentication"],
				operationId: "deleteApiKey",
				summary: "Delete your API key",
				description: "Revokes an API key belonging to the authenticated user.",
			})
			.input(z.object({ keyId: z.string().min(1) }))
			.output(z.object({ success: z.boolean() }))
			.handler(({ context, input }) => accountAuth.deleteApiKey(context.user, input.keyId)),
	},

	providers: {
		list: publicProcedure
			.route({
				method: "GET",
				path: "/auth/providers",
				tags: ["Authentication"],
				operationId: "listAuthProviders",
				summary: "List authentication providers",
				description: `Returns a list of all authentication providers enabled on this ${APP_NAME} instance, along with their display names. Possible providers include password-based credentials, Apple, Google, GitHub, LinkedIn, and custom OAuth. No authentication required.`,
				successDescription: "A map of enabled authentication provider identifiers to their display names.",
			})
			.input(z.object({}).optional())
			.output(
				z.partialRecord(
					z.enum(["credential", "passkey", "apple", "google", "github", "linkedin", "custom"]),
					z.string(),
				),
			)
			.handler(() => authService.providers.list()),
	},

	createApiKey: protectedProcedure
		.route({
			method: "POST",
			path: "/auth/api-keys",
			tags: ["Authentication"],
			operationId: "createScopedApiKey",
			summary: "Create an API key",
			description:
				"Create a read-only or full-access API key. Requires a browser session; keys and OAuth tokens cannot create credentials.",
		})
		.input(
			z.object({
				name: z.string().trim().min(1).max(64),
				expiresIn: z.number().int().positive().nullable(),
				access: z.enum(["read", "full"]),
			}),
		)
		.output(z.object({ key: z.string() }))
		.handler(async ({ context, input }) => {
			if (context.authentication?.method !== "session")
				throw new ORPCError("FORBIDDEN", { message: "Create API keys in your browser settings." });
			const result = await auth.api.createApiKey({
				body: {
					userId: context.user.id,
					name: input.name,
					expiresIn: input.expiresIn,
					permissions: { api: input.access === "read" ? ["read"] : ["read", "write", "delete"] },
				},
			});
			return { key: result.key };
		}),

	exportData: protectedProcedure
		.use(accountRateLimit)
		.route({
			method: "GET",
			path: "/auth/account/export",
			tags: ["Authentication"],
			operationId: "exportAccountData",
			summary: "Export user account data",
			description:
				"Returns a JSON-serializable export of the authenticated user's profile, documents, applications, career knowledge, preparation, schedules and coaching conversations. Images remain URL references; coaching attachments include storage references. Secrets such as password hashes, tokens, and API keys are never included. Requires authentication.",
			successDescription: "The user's exported account data.",
		})
		.input(z.object({}).optional())
		.output(
			z.object({
				exportedAt: z.string(),
				user: createSelectSchema(schema.user).pick({
					id: true,
					name: true,
					email: true,
					username: true,
					displayUsername: true,
					image: true,
					resumePages: true,
					noReplyDays: true,
					interviewReminders: true,
					emailVerified: true,
					createdAt: true,
					updatedAt: true,
				}),
				resumes: z.array(
					resumeDto.getById.output
						.omit({ hasPassword: true, applicationId: true })
						.extend({ slugChosen: z.boolean().describe("The owner chose the public address.") }),
				),
				coverLetters: z.array(coverLetterSchema),
				applications: z.array(applicationDto.getById.output),
				aiContentReports: z.array(createSelectSchema(schema.aiContentReport)),
				career: z.object({
					profile: careerProfileDataSchema,
					aiLimits: aiLimitsSchema.partial().nullable().describe("Settings → AI limits; null uses the defaults."),
					facts: z.array(careerFactSchema.omit({ usedBy: true, company: true })),
					stories: z.array(careerStorySchema),
					artifacts: z.array(savedItemSchema),
					schedules: z.array(careerScheduleSchema),
					notifications: z.array(careerNotificationSchema),
					threads: z.array(createSelectSchema(schema.agentThread)),
					messages: z.array(
						createSelectSchema(schema.agentMessage, {
							// Preserve historical SDK/tool message fields in their original export form.
							uiMessage: z.record(z.string(), z.unknown()),
						}),
					),
					attachments: z.array(createSelectSchema(schema.agentAttachment)),
					opportunities: z.array(createSelectSchema(schema.careerOpportunity)),
					jobs: z.array(createSelectSchema(schema.careerJob)),
					transcripts: z.array(createSelectSchema(schema.careerTranscript)),
					workspaces: z.array(createSelectSchema(schema.careerWorkspace, { data: careerWorkspaceSchema })),
					factGroups: z.array(createSelectSchema(schema.careerFactGroup)),
					factOverrides: z.array(createSelectSchema(schema.careerFactOverride)),
					review: knowledgeReviewSchema.nullable(),
				}),
			}),
		)
		.handler(({ context }) => authService.exportData({ userId: context.user.id })),

	importPreview: protectedProcedure
		.use(accountRateLimit)
		.route({
			method: "GET",
			path: "/auth/account/imports/preview",
			tags: ["Authentication"],
			operationId: "previewAccountImport",
			summary: "Count what an account import could replace",
			description:
				"Returns how many records the authenticated user has in each import area, so a client can say what replacing an area deletes. Requires authentication.",
			successDescription: "Counts per import area.",
		})
		.input(z.object({}).optional())
		.output(accountImportDto.preview.output)
		.handler(({ context }) => accountImportService.preview(context.user.id)),

	importData: protectedProcedure
		.use(accountRateLimit)
		.route({
			method: "POST",
			path: "/auth/account/imports",
			tags: ["Authentication"],
			operationId: "importAccountData",
			summary: "Import one area of an account export",
			description:
				'Imports one area (documents, applications, knowledge, jobSearch, coach or settings) of an "Export everything" archive from Reactive Resume or All That Work into the authenticated account. Send the areas in that order and pass the ids each one returns to the next. Records get new ids; public resumes come in private; schedules come in switched off. In replace mode the area\'s existing records are deleted first, in the same transaction. Requires authentication.',
			successDescription: "What was added and skipped, and the new ids.",
		})
		.input(accountImportDto.run.input)
		.output(accountImportDto.run.output)
		.handler(({ context, input }) => accountImportService.run(context.user.id, input)),

	deleteAccount: protectedProcedure
		.route({
			spec: (operation) => ({ ...operation, security: [{ cookieAuth: [] }] }),
			method: "DELETE",
			path: "/auth/account",
			tags: ["Authentication"],
			operationId: "deleteAccount",
			summary: "Delete user account",
			description:
				"Permanently deletes the authenticated user's account, including all resumes, uploaded files (profile pictures, screenshots, PDFs), and associated data. This action is irreversible. Requires a browser session; keys and OAuth tokens cannot delete accounts.",
			successDescription: "The user account and all associated data have been successfully deleted.",
		})
		.input(z.object({}).optional())
		.output(z.void())
		.handler(async ({ context }) => {
			if (context.authentication?.method !== "session")
				throw new ORPCError("FORBIDDEN", { message: "Account deletion must be performed in your browser settings." });
			await authService.deleteAccount({ userId: context.user.id });
		}),
};
