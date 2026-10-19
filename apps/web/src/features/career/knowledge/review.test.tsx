// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
	data: {} as Record<string, unknown>,
	provider: null as { label: string } | null,
	run: vi.fn(),
	updateFact: vi.fn(),
	resolveFinding: vi.fn(),
}));
vi.mock("@/libs/orpc/client", () => {
	const endpoint = (name: string) => ({
		key: () => [name],
		queryKey: () => [name],
		queryOptions: () => ({ queryKey: [name], queryFn: async () => api.data[name], retry: false }),
		mutationOptions: () => ({ mutationFn: api.run }),
	});
	return {
		orpc: {
			career: Object.fromEntries(
				["review", "runReview", "facts", "stories", "duplicates", "factGroups"].map((name) => [name, endpoint(name)]),
			),
		},
		client: { career: { updateFact: api.updateFact, resolveFinding: api.resolveFinding } },
	};
});
vi.mock("../hooks", () => ({ useDefaultProvider: () => ({ provider: api.provider, isUnavailable: false }) }));
vi.mock("../shared", () => ({
	useCareerTime: () => ({ format: () => "Oct 18" }),
	PrivacyLine: ({ children }: { children: ReactNode }) => <p>{children}</p>,
	Working: () => <p>Working</p>,
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children?: ReactNode }) => <a href="#link">{children}</a>,
}));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn() } }));

i18n.loadAndActivate({ locale: "en", messages: {} });
const { ReviewCard } = await import("./review");

const fact = (id: string, text: string, status = "active") => ({ id, text, status });
const finding = (id: string, kind: string, factIds: string[], keep: string | null = null, resolved = null) => ({
	id,
	kind,
	factIds,
	note: `Note ${id}`,
	keep,
	resolved,
});
const mount = () =>
	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={new QueryClient()}>
				<ReviewCard />
			</QueryClientProvider>
		</I18nProvider>,
	);

describe("Knowledge review", () => {
	beforeEach(() => {
		api.provider = { label: "Test connection" };
		api.run.mockReset();
		api.updateFact.mockReset().mockResolvedValue(undefined);
		api.resolveFinding.mockReset().mockImplementation(async () => api.data.review);
		api.data = {
			facts: [
				fact("old", "Team of 8 in 2023."),
				fact("new", "Team of 12 in 2025."),
				fact("claim", "Cut costs by 40 percent."),
				fact("gone", "An archived fact.", "archived"),
			],
			review: {
				at: "2026-10-18T00:00:00.000Z",
				connection: "Test connection",
				reviewed: 3,
				total: 5,
				cleaned: 2,
				findings: [
					finding("f1", "superseded", ["old", "new"], "new"),
					finding("f2", "unsupported", ["claim"]),
					finding("f3", "contradiction", ["new", "gone"]),
					finding("f4", "contradiction", ["old", "claim"], null, "dismissed" as never),
				],
			},
		};
	});
	afterEach(cleanup);

	it("lists only open findings whose facts are still in use, and says what the last review covered", async () => {
		mount();
		expect(await screen.findByText("Note f1")).toBeTruthy();
		expect(screen.getByText("Note f2")).toBeTruthy();
		expect(screen.queryByText("Note f3")).toBeNull();
		expect(screen.queryByText("Note f4")).toBeNull();
		expect(screen.getByText(/read 3 of 5 facts/)).toBeTruthy();
		expect(screen.getByText(/Removed 2 copies/)).toBeTruthy();
	});

	it("archives the older fact when the newer one is kept, and dismisses a finding", async () => {
		mount();
		fireEvent.click(await screen.findByRole("button", { name: "Keep the newer one" }));
		await waitFor(() => expect(api.resolveFinding).toHaveBeenCalledWith({ id: "f1", resolved: "fixed" }));
		expect(api.updateFact).toHaveBeenCalledWith({ id: "old", status: "archived" });

		fireEvent.click(screen.getAllByRole("button", { name: "Not a problem" })[1] as HTMLElement);
		await waitFor(() => expect(api.resolveFinding).toHaveBeenCalledWith({ id: "f2", resolved: "dismissed" }));
		expect(api.updateFact).toHaveBeenCalledTimes(1);
	});

	it("runs a review on the default connection, and offers to connect one when there's none", async () => {
		api.run.mockResolvedValue(api.data.review);
		mount();
		fireEvent.click(await screen.findByRole("button", { name: "Review again" }));
		await waitFor(() => expect(api.run).toHaveBeenCalled());
		cleanup();
		api.provider = null;
		api.data.review = null;
		mount();
		expect(await screen.findByText("Connect an AI provider in Settings")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Review my Knowledge" })).toBeNull();
	});
});
