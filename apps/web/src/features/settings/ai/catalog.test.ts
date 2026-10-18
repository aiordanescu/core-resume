import type { ModelSuggestions } from "./catalog";
import { expect, it, vi } from "vitest";
import { loadModelSuggestions, suggestedModel } from "./catalog";

it("suggests current text models with provider-specific IDs and tolerates incomplete catalog entries", async () => {
	const model = {
		id: "openai/gpt-example",
		name: "GPT Example",
		release_date: "2026-09-01",
		modalities: { input: ["text", "image"], output: ["text"] },
		limit: { context: 128000, output: 8192 },
	};
	const fetchCatalog = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
		Response.json({
			vercel: {
				models: {
					chat: model,
					older: { ...model, id: "anthropic/claude-example", name: "Claude Example", release_date: "2026-08-01" },
					retired: { ...model, id: "retired", status: "deprecated" },
					audio: { ...model, id: "audio", modalities: { input: ["audio"], output: ["text"] } },
					image: { ...model, id: "image", modalities: { input: ["text"], output: ["image"] } },
					embedding: { ...model, id: "embedding", limit: { context: 8192, output: 0 } },
					incomplete: { name: "Incomplete entry" },
				},
			},
			google: { models: { chat: { ...model, id: "gemini-example", name: "Gemini Example" } } },
			"fireworks-ai": { models: { chat: { ...model, id: "accounts/fireworks/models/example" } } },
			"ollama-cloud": { models: { chat: { ...model, id: "example:cloud" } } },
			anthropic: null,
		}),
	);
	try {
		const catalog = await loadModelSuggestions(new AbortController().signal);
		expect(catalog.vercel?.map(({ id, name }) => ({ id, name }))).toEqual([
			{ id: "openai/gpt-example", name: "GPT Example" },
			{ id: "anthropic/claude-example", name: "Claude Example" },
		]);
		expect(catalog.google?.[0]?.id).toBe("gemini-example");
		expect(catalog["fireworks-ai"]?.[0]?.id).toBe("accounts/fireworks/models/example");
		expect(catalog["ollama-cloud"]?.[0]?.id).toBe("example:cloud");
		expect(catalog.anthropic).toEqual([]);

		fetchCatalog.mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
		await expect(loadModelSuggestions(new AbortController().signal)).rejects.toThrow("unavailable");
		fetchCatalog.mockResolvedValueOnce(Response.json(null));
		await expect(loadModelSuggestions(new AbortController().signal)).rejects.toThrow();
	} finally {
		fetchCatalog.mockRestore();
	}
});

it("prefills the newest model in the provider's family, the newest overall without one, and nothing otherwise", () => {
	const entry = (id: string) => ({
		id,
		name: id,
		modalities: { input: ["text"], output: ["text"] },
		limit: { context: 128000, output: 8192 },
	});
	// Newest first, as loadModelSuggestions sorts them.
	const catalog: ModelSuggestions = {
		cohere: [entry("north-small-translate"), entry("command-a-plus"), entry("command-a")],
		openrouter: [entry("deepseek/deepseek-flash"), entry("openai/gpt-example")],
		xai: [entry("aurora-image-text")],
		anthropic: [],
	};

	expect(suggestedModel(catalog, "cohere")).toBe("command-a-plus");
	expect(suggestedModel(catalog, "openrouter")).toBe("deepseek/deepseek-flash");
	expect(suggestedModel(catalog, "xai")).toBe("aurora-image-text");
	expect(suggestedModel(catalog, "anthropic")).toBe("");
	expect(suggestedModel(catalog, "openai-compatible")).toBe("");
	expect(suggestedModel(undefined, "openai")).toBe("");
});
