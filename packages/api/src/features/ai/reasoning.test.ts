import { afterEach, describe, expect, it, vi } from "vitest";
import { generateText } from "ai";

vi.mock("@reactive-resume/env/server", () => ({ env: { FLAG_ALLOW_UNSAFE_AI_BASE_URL: false } }));

afterEach(() => {
	vi.unstubAllGlobals();
});

/** Answers every chat-completions call with "1" and keeps the request bodies. */
function stubChat() {
	const bodies: Array<Record<string, unknown>> = [];
	vi.stubGlobal(
		"fetch",
		vi.fn((_input: unknown, init?: { body?: unknown }) => {
			bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
			return new Response(
				JSON.stringify({
					id: "chatcmpl-test",
					object: "chat.completion",
					created: 1,
					model: "test-model",
					choices: [{ index: 0, message: { role: "assistant", content: "1" }, finish_reason: "stop" }],
					usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
				}),
				{ headers: { "Content-Type": "application/json" } },
			);
		}),
	);
	return bodies;
}

const { getModel, testConnection } = await import("./service");

const send = async (input: Parameters<typeof getModel>[0]) => {
	const bodies = stubChat();
	await generateText({ model: getModel(input), prompt: "Hi", maxRetries: 0 });
	return bodies[0] ?? {};
};

const compatible = {
	provider: "openai-compatible" as const,
	model: "m",
	apiKey: "k",
	baseURL: "https://llm.example.test/v1",
};

describe("connection reasoning", () => {
	it("sends nothing for Model default", async () => {
		const body = await send({ ...compatible, reasoning: null });
		expect(body).not.toHaveProperty("reasoning_effort");
		expect(body).not.toHaveProperty("chat_template_kwargs");
	});

	it.each(["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const)(
		"sends %s as reasoning_effort to OpenAI-compatible servers",
		async (reasoning) => {
			expect(await send({ ...compatible, reasoning })).toMatchObject({ reasoning_effort: reasoning });
		},
	);

	it("passes Ultra through as-is to OpenAI-compatible servers and OpenRouter", async () => {
		expect(await send({ ...compatible, reasoning: "ultra" })).toMatchObject({ reasoning_effort: "ultra" });
		expect(
			await send({
				provider: "openrouter",
				model: "m",
				apiKey: "k",
				baseURL: "https://openrouter.ai/api/v1",
				reasoning: "ultra",
			}),
		).toMatchObject({ reasoning_effort: "ultra" });
	});

	it("translates the level for OpenAI chat models", async () => {
		const body = await send({
			provider: "openai",
			model: "o4-mini",
			apiKey: "k",
			baseURL: "https://gateway.example.test/v1",
			reasoning: "low",
		});
		expect(body).toMatchObject({ reasoning_effort: "low" });
	});

	it("gives a connection test room to think when an effort is set", async () => {
		const bodies = stubChat();
		await expect(testConnection({ ...compatible, reasoning: "high" })).resolves.toEqual({ ok: true });
		await expect(testConnection({ ...compatible, reasoning: "none" })).resolves.toEqual({ ok: true });
		expect(bodies.map((body) => [body.reasoning_effort, body.max_tokens])).toEqual([
			["high", 4096],
			["none", 128],
		]);
	});
});
