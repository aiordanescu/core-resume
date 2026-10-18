import z from "zod";
import { aiReasoningSchema } from "@reactive-resume/ai/reasoning";
import { aiProviderSchema } from "@reactive-resume/ai/types";

export const aiProviderResponseSchema = z.object({
	managed: z.boolean(),
	id: z.string(),
	label: z.string(),
	provider: aiProviderSchema,
	model: z.string(),
	baseURL: z.string().nullable(),
	/** "none" switches thinking off, an effort switches it on at that level; null sends nothing (Model default). */
	reasoning: aiReasoningSchema.nullable(),
	enabled: z.boolean(),
	/** Used whenever no connection is chosen, while it's switched on and tested. */
	isDefault: z.boolean(),
	testStatus: z.string(),
	testError: z.string().nullable(),
	apiKeyPreview: z.string(),
	apiKeyFingerprint: z.string(),
	lastTestedAt: z.date().nullable(),
	lastUsedAt: z.date().nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),
});
