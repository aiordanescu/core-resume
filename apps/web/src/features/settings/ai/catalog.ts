import type { ComboboxOption } from "@/components/ui/combobox";
import type { AIProvider } from "@reactive-resume/ai/types";
import { z } from "zod";
import { AI_PROVIDER_DEFAULT_BASE_URLS } from "@reactive-resume/ai/types";

export const modelsDevProviderIds: Record<AIProvider, string | null> = {
	openai: "openai",
	anthropic: "anthropic",
	gemini: "google",
	"vercel-ai-gateway": "vercel",
	openrouter: "openrouter",
	mistral: "mistral",
	cohere: "cohere",
	xai: "xai",
	groq: "groq",
	deepseek: "deepseek",
	togetherai: "togetherai",
	fireworks: "fireworks-ai",
	cerebras: "cerebras",
	perplexity: "perplexity",
	ollama: "ollama-cloud",
	"openai-compatible": null,
};

const catalogProviderSchema = z.object({ models: z.record(z.string(), z.unknown()) });
const catalogModelSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	release_date: z.string().optional(),
	status: z.string().optional(),
	modalities: z.object({ input: z.array(z.string()), output: z.array(z.string()) }),
	limit: z.object({ context: z.number().positive(), output: z.number().positive() }),
});

/** Public, optional suggestions. Provider-specific IDs must be kept intact, including gateway prefixes. */
export async function loadModelSuggestions(signal: AbortSignal) {
	const response = await fetch("https://models.dev/api.json", {
		signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
		credentials: "omit",
		referrerPolicy: "no-referrer",
	});
	if (!response.ok) throw new Error("Model suggestions are unavailable");
	const catalog = z.record(z.string(), z.unknown()).parse(await response.json());
	return Object.fromEntries<z.infer<typeof catalogModelSchema>[]>(
		Object.values(modelsDevProviderIds).flatMap((id) => {
			if (!id) return [];
			const provider = catalogProviderSchema.safeParse(catalog[id]);
			const models = provider.success
				? Object.values(provider.data.models).flatMap((entry) => {
						const model = catalogModelSchema.safeParse(entry);
						if (
							!model.success ||
							model.data.status === "deprecated" ||
							!model.data.modalities.input.includes("text") ||
							!model.data.modalities.output.includes("text")
						)
							return [];
						return [model.data];
					})
				: [];
			models.sort((a, b) => (b.release_date ?? "").localeCompare(a.release_date ?? "") || a.name.localeCompare(b.name));
			return [[id, models]];
		}),
	);
}

export type AIProviderOption = ComboboxOption<AIProvider> & {
	defaultBaseURL: string;
	/** The ID prefix of the provider's main chat models, so the prefill skips specialised ones (translation, research). */
	modelFamily?: string;
};

// Provider labels are brand names and stay untranslated on purpose, so every locale shows the
// vendor's own spelling instead of a literal translation (e.g. "Google Gemini", not "谷歌双子座").
export const providerOptions: AIProviderOption[] = [
	{
		value: "openai",
		label: "OpenAI",
		keywords: ["openai", "gpt", "chatgpt"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.openai,
		modelFamily: "gpt-",
	},
	{
		value: "anthropic",
		label: "Anthropic Claude",
		keywords: ["anthropic", "claude", "ai"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.anthropic,
		modelFamily: "claude-",
	},
	{
		value: "gemini",
		label: "Google Gemini",
		keywords: ["gemini", "google"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.gemini,
		modelFamily: "gemini-",
	},
	{
		value: "vercel-ai-gateway",
		label: "Vercel AI Gateway",
		keywords: ["vercel", "gateway", "ai"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS["vercel-ai-gateway"],
	},
	{
		value: "openrouter",
		label: "OpenRouter",
		keywords: ["openrouter", "router"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.openrouter,
	},
	{
		value: "mistral",
		label: "Mistral AI",
		keywords: ["mistral", "magistral"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.mistral,
		modelFamily: "mistral-",
	},
	{
		value: "cohere",
		label: "Cohere",
		keywords: ["cohere", "command"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.cohere,
		modelFamily: "command-",
	},
	{
		value: "xai",
		label: "xAI Grok",
		keywords: ["xai", "grok"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.xai,
		modelFamily: "grok-",
	},
	{
		value: "groq",
		label: "Groq",
		keywords: ["groq", "llama"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.groq,
	},
	{
		value: "deepseek",
		label: "DeepSeek",
		keywords: ["deepseek"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.deepseek,
	},
	{
		value: "togetherai",
		label: "Together.ai",
		keywords: ["together", "togetherai", "llama"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.togetherai,
	},
	{
		value: "fireworks",
		label: "Fireworks",
		keywords: ["fireworks", "llama", "deepseek"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.fireworks,
	},
	{
		value: "cerebras",
		label: "Cerebras",
		keywords: ["cerebras", "llama"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.cerebras,
	},
	{
		value: "perplexity",
		label: "Perplexity",
		keywords: ["perplexity", "sonar"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.perplexity,
		modelFamily: "sonar-pro",
	},
	{
		value: "ollama",
		label: "Ollama",
		keywords: ["ollama", "cloud"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS.ollama,
	},
	{
		value: "openai-compatible",
		label: "OpenAI-compatible",
		keywords: ["compatible", "custom", "gateway"],
		defaultBaseURL: AI_PROVIDER_DEFAULT_BASE_URLS["openai-compatible"],
	},
];

// Prefill Base URL from the provider's known default when the provider changes. The model comes from suggestedModel.
export function providerDefaults(provider: AIProvider) {
	const option = providerOptions.find((entry) => entry.value === provider);
	return { baseURL: option?.defaultBaseURL ?? AI_PROVIDER_DEFAULT_BASE_URLS[provider] ?? "" };
}

export type ModelSuggestions = Awaited<ReturnType<typeof loadModelSuggestions>>;

export const modelSuggestionsQuery = {
	queryKey: ["models.dev"],
	queryFn: ({ signal }: { signal: AbortSignal }) => loadModelSuggestions(signal),
	staleTime: 60 * 60 * 1000,
	retry: false,
} as const;

/**
 * The model to prefill for a new provider: the newest suggestion in its model family, or the newest of all when the
 * family has none. Empty when the provider has no catalog or the suggestions didn't load.
 */
export function suggestedModel(catalog: ModelSuggestions | undefined, provider: AIProvider) {
	const catalogId = modelsDevProviderIds[provider];
	const models = (catalogId && catalog?.[catalogId]) || [];
	const family = providerOptions.find((option) => option.value === provider)?.modelFamily;
	const inFamily = family ? models.filter((model) => model.id.startsWith(family)) : [];
	return (inFamily[0] ?? models[0])?.id ?? "";
}

export function providerLabel(provider: AIProvider) {
	return String(providerOptions.find((option) => option.value === provider)?.label ?? provider);
}

/** "…9f2a" from the stored preview ("sk-a...9f2a"); short keys only ever show dots. */
export function keyEnding(preview: string) {
	const [, end] = preview.split("...");
	return end ? `…${end}` : preview;
}

type TestResult = { testStatus: string; testError: string | null };

/**
 * What Test says after it runs: "Connected · 420 ms", with the round trip measured in the browser, or the provider's
 * own error so it can be fixed here.
 */
export function describeTest(result: TestResult, milliseconds: number, labels: { connected: string; failed: string }) {
	if (result.testStatus === "success")
		return { ok: true, label: `${labels.connected} · ${Math.round(milliseconds)} ms`, error: null };
	return { ok: false, label: labels.failed, error: result.testError?.trim() || null };
}
