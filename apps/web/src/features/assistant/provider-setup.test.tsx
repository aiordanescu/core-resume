// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tanstack/react-router", () => ({ Link: ({ children }: { children: unknown }) => children }));
vi.mock("@/libs/orpc/client", () => ({
	client: { aiProviders: { create: vi.fn(), test: vi.fn() } },
	orpc: { aiProviders: { list: { key: () => ["aiProviders"] } } },
}));

i18n.loadAndActivate({ locale: "en", messages: {} });

const { ProviderSetup } = await import("./provider-setup");

const entry = (id: string, release_date: string) => ({
	id,
	name: id,
	release_date,
	modalities: { input: ["text"], output: ["text"] },
	limit: { context: 128000, output: 8192 },
});

function renderSetup() {
	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={new QueryClient()}>
				<ProviderSetup />
			</QueryClientProvider>
		</I18nProvider>,
	);
}

const expand = (name: RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const modelInput = () => screen.getByLabelText("Model") as HTMLInputElement;

describe("Assistant provider setup", () => {
	afterEach(() => vi.restoreAllMocks());

	it("suggests the newest models.dev model without filling the box, so every model stays listed", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			Response.json({
				openai: { models: { old: entry("gpt-old", "2025-04-14"), new: entry("gpt-new", "2026-09-29") } },
				anthropic: { models: { a: entry("claude-new", "2026-10-07") } },
			}),
		);
		renderSetup();

		expand(/^OpenAI$/);
		await waitFor(() => expect(modelInput().placeholder).toBe("gpt-new"));
		expect(modelInput().value).toBe("");
		const options = [...(modelInput().list?.options ?? [])].map((option) => option.value);
		expect(options).toEqual(["gpt-new", "gpt-old"]);

		expand(/^Anthropic$/);
		await waitFor(() => expect(modelInput().placeholder).toBe("claude-new"));
		expect(modelInput().value).toBe("");

		expand(/OpenAI-compatible/);
		await waitFor(() => expect(screen.getByLabelText("Base URL")).toBeTruthy());
		expect(modelInput().placeholder).toBe("");
	});

	it("leaves the model blank when models.dev doesn't load", async () => {
		const fetchCatalog = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Unavailable", { status: 503 }));
		renderSetup();

		expand(/^OpenAI$/);
		await waitFor(() => expect(fetchCatalog).toHaveBeenCalled());
		expect(modelInput().value).toBe("");
		expect(modelInput().placeholder).toBe("");
	});
});
