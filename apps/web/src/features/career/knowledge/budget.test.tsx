// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { aiLimitsSchema } from "@reactive-resume/schema/career";

const api = vi.hoisted(() => ({
	data: {} as Record<string, unknown>,
	update: vi.fn(),
}));
vi.mock("@/libs/orpc/client", () => {
	const endpoint = (name: string) => ({
		key: () => [name],
		queryKey: () => [name],
		queryOptions: () => ({ queryKey: [name], queryFn: async () => api.data[name], retry: false }),
		mutationOptions: () => ({ mutationFn: api.update }),
	});
	return {
		orpc: {
			career: {
				facts: endpoint("facts"),
				stories: endpoint("stories"),
				aiLimits: endpoint("aiLimits"),
				factGroups: endpoint("factGroups"),
				overrides: endpoint("overrides"),
			},
			aiProviders: { list: endpoint("providers"), update: endpoint("update") },
		},
	};
});
vi.mock("@/features/settings/ai/catalog", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/features/settings/ai/catalog")>()),
	modelSuggestionsQuery: {
		queryKey: ["models.dev"],
		queryFn: async () => ({
			anthropic: [
				{
					id: "claude-small",
					name: "Claude Small",
					modalities: { input: ["text"], output: ["text"] },
					limit: { context: 8000, output: 4096 },
				},
			],
		}),
	},
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: ReactNode }) => <a href="#test-link">{children}</a>,
}));

i18n.loadAndActivate({ locale: "en", messages: {} });
const { BudgetMeter } = await import("./budget");

const fact = (id: string, text: string, status = "active", applicationId: string | null = null) => ({
	id,
	text,
	category: "accomplishment",
	status,
	applicationId,
	revisions: [],
});
const provider = (model: string, contextTokens: number | null, extra: object = {}) => ({
	id: "provider-1",
	provider: "anthropic",
	model,
	contextTokens,
	managed: false,
	enabled: true,
	testStatus: "success",
	...extra,
});

function renderMeter() {
	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
				<BudgetMeter />
			</QueryClientProvider>
		</I18nProvider>,
	);
}

describe("Knowledge budget", () => {
	beforeEach(() => {
		api.update.mockReset().mockResolvedValue({});
		api.data = {
			facts: [
				fact("on", "I lead incident reviews."),
				fact("off", "A switched-off fact.", "excluded"),
				fact("private", "Private to one application.", "active", "app-1"),
			],
			stories: [],
			aiLimits: aiLimitsSchema.parse({ coachFacts: 5, actionFactChars: 2000, actionStoryChars: 2000 }),
			providers: [provider("claude-small", null)],
			factGroups: [],
		};
	});
	afterEach(cleanup);

	it("counts only shared, switched-on facts and warns when the budget outgrows the model", async () => {
		renderMeter();
		expect(await screen.findByText(/1 fact switched on/)).toBeTruthy();
		expect(screen.getByText(/The Coach shares up to 5 of 1 facts/)).toBeTruthy();
		expect(screen.queryByText(/Over budget/)).toBeNull();
		expect(await screen.findByText(/claude-small reads up to 8,000 tokens \(from models.dev\)/)).toBeTruthy();
		// 2,000 + 2,000 + 40,000 characters is about 11,000 tokens, more than 8,000.
		expect(screen.getByText(/larger than this model's context window/)).toBeTruthy();
	});

	it("says when switched-on facts are over the budget", async () => {
		api.data.facts = Array.from({ length: 80 }, (_, index) => fact(`f${index}`, "I lead weekly incident reviews."));
		renderMeter();
		expect(await screen.findByText(/Over budget/)).toBeTruthy();
		expect(screen.getByRole("meter", { name: "Facts in each action" }).getAttribute("aria-valuenow")).toBe("2000");
	});

	it("asks for the context window of a model models.dev doesn't list, and saves it on the connection", async () => {
		api.data.providers = [provider("auto", null, { provider: "openai-compatible" })];
		renderMeter();
		fireEvent.click(await screen.findByRole("button", { name: "Set it" }));
		fireEvent.change(screen.getByLabelText("Context window of auto"), { target: { value: "131072" } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(api.update).toHaveBeenCalled());
		expect(api.update.mock.calls[0]?.[0]).toEqual({ id: "provider-1", contextTokens: 131072 });
	});

	it("uses a context window set by hand over the catalog", async () => {
		api.data.providers = [provider("claude-small", 1_000_000)];
		renderMeter();
		expect(await screen.findByText(/claude-small reads up to 1,000,000 tokens \(set by you\)/)).toBeTruthy();
		expect(screen.queryByText(/larger than this model's context window/)).toBeNull();
	});
});
