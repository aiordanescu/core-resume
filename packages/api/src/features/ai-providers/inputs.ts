import z from "zod";
import { acceptsCustomReasoning, aiReasoningSchema } from "@reactive-resume/ai/reasoning";
import { aiProviderSchema } from "@reactive-resume/ai/types";

const providerFields = z.object({
	label: z.string().trim().min(1),
	provider: aiProviderSchema,
	model: z.string().trim().min(1),
	baseURL: z.string().trim().optional(),
	apiKey: z.string().trim(),
	reasoning: aiReasoningSchema
		.nullable()
		.optional()
		.describe(
			'"none" switches thinking off; minimal, low, medium, high, xhigh, max or ultra switch it on at that effort. Null or omitted sends nothing, so the model\'s own default applies. Ultra only on OpenAI-compatible and OpenRouter connections.',
		),
	contextTokens: z
		.number()
		.int()
		.min(1000)
		.max(100_000_000)
		.nullable()
		.optional()
		.describe(
			"The model's context window in tokens, for the Knowledge budget meter. Null or omitted looks the model up on models.dev; set it for models that list doesn't know, such as a gateway alias.",
		),
});

export const ULTRA_UNSUPPORTED = "Ultra effort is only available for OpenAI-compatible and OpenRouter connections.";

export const providerInput = providerFields
	.refine((input) => input.provider === "ollama" || input.apiKey.length > 0, {
		message: "An API key is required for this provider.",
		path: ["apiKey"],
	})
	.refine((input) => input.reasoning !== "ultra" || acceptsCustomReasoning(input.provider), {
		message: ULTRA_UNSUPPORTED,
		path: ["reasoning"],
	});

export const updateProviderInput = providerFields
	.partial()
	.extend({ id: z.string(), enabled: z.boolean().optional() })
	.refine((input) => input.apiKey === undefined || input.apiKey.length > 0 || input.provider === "ollama", {
		message: "An API key is required for this provider.",
		path: ["apiKey"],
	})
	.refine((input) => Object.keys(input).some((key) => key !== "id"), {
		message: "At least one field must be provided.",
	});
