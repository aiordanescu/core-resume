// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
	data: {} as Record<string, unknown>,
	clean: vi.fn(),
	merge: vi.fn(),
	saveStory: vi.fn(),
}));
vi.mock("@/libs/orpc/client", () => {
	const endpoint = (name: string) => ({
		key: () => [name],
		queryOptions: () => ({ queryKey: [name], queryFn: async () => api.data[name], retry: false }),
		mutationOptions: () => ({ mutationFn: api.clean }),
	});
	return {
		orpc: {
			career: Object.fromEntries(
				["duplicates", "cleanDuplicates", "facts", "stories", "factGroups", "overrides"].map((name) => [
					name,
					endpoint(name),
				]),
			),
		},
		client: { career: { mergeFact: api.merge, saveStory: api.saveStory } },
	};
});
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children?: ReactNode }) => <a href="#story">{children}</a>,
}));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn() } }));

i18n.loadAndActivate({ locale: "en", messages: {} });
const { DuplicatesCard, StoriesCard } = await import("./upkeep");

const duplicate = (id: string, text: string, applicationId: string | null = null) => ({
	id,
	text,
	applicationId,
	status: "active",
	group: null,
});
const mount = (children: ReactNode) =>
	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
		</I18nProvider>,
	);

describe("Duplicates", () => {
	beforeEach(() => {
		localStorage.clear();
		api.clean.mockReset().mockResolvedValue({ updated: 2 });
		api.merge.mockReset().mockResolvedValue({ updated: 1 });
		api.data = {
			duplicates: {
				exact: [
					{ keep: "shared", copies: ["copy-a", "copy-b"] },
					{ keep: "twin-1", copies: ["twin-2"] },
				],
				near: [{ factIds: ["near-1", "near-2"], similarity: 0.82 }],
				facts: [
					duplicate("shared", "I led the Acme migration."),
					duplicate("copy-a", "I led the Acme migration.", "app-a"),
					duplicate("copy-b", "I led the Acme migration.", "app-b"),
					duplicate("twin-1", "I mentor engineers."),
					duplicate("twin-2", "I mentor engineers."),
					duplicate("near-1", "Led 40 services to Kubernetes at Acme."),
					duplicate("near-2", "Led 40 services onto Kubernetes, Acme.", "app-a"),
				],
			},
		};
	});
	afterEach(cleanup);

	it("removes application copies of shared facts in one step", async () => {
		mount(<DuplicatesCard />);
		expect(await screen.findByText(/2 application facts are word-for-word copies/)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Remove copies" }));
		await waitFor(() => expect(api.clean).toHaveBeenCalled());
	});

	it("keeps one of a shared pair, and only lets a near duplicate keep a fact that reaches the other's scope", async () => {
		mount(<DuplicatesCard />);
		expect(await screen.findByText("Said 2 times")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Keep one" }));
		await waitFor(() => expect(api.merge).toHaveBeenCalledWith({ id: "twin-2", into: "twin-1" }));

		expect(screen.getByText("Nearly the same · 82%")).toBeTruthy();
		const [keepShared, keepPrivate] = screen.getAllByRole("button", { name: "Keep this one" });
		// The private one can't absorb a shared fact.
		expect(keepPrivate?.hasAttribute("disabled")).toBe(true);
		fireEvent.click(keepShared as HTMLElement);
		await waitFor(() => expect(api.merge).toHaveBeenCalledWith({ id: "near-2", into: "near-1" }));
	});

	it("hides a pair that isn't a duplicate, and remembers it", async () => {
		mount(<DuplicatesCard />);
		fireEvent.click(await screen.findByRole("button", { name: "Not the same" }));
		expect(screen.queryByText("Nearly the same · 82%")).toBeNull();
		cleanup();
		mount(<DuplicatesCard />);
		await screen.findByText("Said 2 times");
		expect(screen.queryByText("Nearly the same · 82%")).toBeNull();
	});
});

describe("Stories the AI can't use", () => {
	const fact = (id: string, text: string, status = "active", revisions: { text: string; at: string }[] = []) => ({
		id,
		text,
		status,
		group: null,
		applicationId: null,
		revisions,
	});
	const story = (id: string, title: string, factIds: string[]) => ({
		id,
		updatedAt: "2026-10-10T00:00:00.000Z",
		applicationId: null,
		data: {
			applicationId: null,
			title,
			situation: "S",
			task: "T",
			action: "A",
			result: "",
			reflection: "",
			factIds,
			tags: [],
		},
	});

	beforeEach(() => {
		api.saveStory.mockReset().mockResolvedValue({});
		api.data = {
			factGroups: [],
			facts: [
				fact("fixed", "I cut costs by 25 percent.", "active", [
					{ text: "I cut costs by 40 percent.", at: "2026-10-12T00:00:00.000Z" },
				]),
				fact("off", "I ran the rota.", "excluded"),
				fact("fine", "I mentor engineers."),
			],
			stories: [
				story("s-fixed", "Cost cutting", ["fixed"]),
				story("s-off", "On-call", ["off", "fine"]),
				story("s-fine", "Mentoring", ["fine"]),
			],
		};
	});
	afterEach(cleanup);

	it("lists only blocked stories, shows a correction's old and new text, and confirms a story in one step", async () => {
		mount(<StoriesCard />);
		expect(await screen.findByText("Cost cutting")).toBeTruthy();
		expect(screen.getByText("On-call")).toBeTruthy();
		expect(screen.queryByText("Mentoring")).toBeNull();
		expect(screen.getByText("I cut costs by 40 percent.")).toBeTruthy();
		expect(screen.getByText("Switched off: “I ran the rota.”")).toBeTruthy();
		// Only the corrected story can be confirmed as it is.
		const confirm = screen.getAllByRole("button", { name: "Still true, use it" });
		expect(confirm).toHaveLength(1);
		fireEvent.click(confirm[0] as HTMLElement);
		await waitFor(() => expect(api.saveStory).toHaveBeenCalled());
		expect(api.saveStory.mock.calls[0]?.[0]).toMatchObject({ id: "s-fixed", applicationId: null, factIds: ["fixed"] });
	});
});
