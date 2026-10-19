// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({ groups: [] as unknown[], setStatus: vi.fn(), savePrivacy: vi.fn() }));
vi.mock("@/libs/orpc/client", () => {
	const endpoint = (name: string) => ({
		key: () => [name],
		queryOptions: () => ({ queryKey: [name], queryFn: async () => api.groups, retry: false }),
		mutationOptions: () => ({ mutationFn: name === "saveFactGroup" ? api.savePrivacy : api.setStatus }),
	});
	return {
		orpc: {
			career: {
				factGroups: endpoint("factGroups"),
				setFactGroupStatus: endpoint("setFactGroupStatus"),
				saveFactGroup: endpoint("saveFactGroup"),
				facts: endpoint("facts"),
				stories: endpoint("stories"),
			},
		},
	};
});
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn() } }));

i18n.loadAndActivate({ locale: "en", messages: {} });
const { GroupsCard, groupTree } = await import("./groups");

const entry = (
	group: string | null,
	active: number,
	excluded: number,
	status: "active" | "excluded" | null = null,
	isPrivate = false,
) => ({
	group,
	status,
	private: isPrivate,
	facts: { active, excluded },
	activeChars: active * 100,
});

describe("groupTree", () => {
	it("adds parents with no facts of their own and counts subgroups in", () => {
		const tree = groupTree([
			entry("experience/acme", 2, 1),
			entry("experience/globex", 1, 0, "active"),
			entry("clearance", 0, 18, "excluded"),
			entry(null, 5, 0),
		]);
		expect(tree.map((node) => [node.path, node.depth])).toEqual([
			["clearance", 0],
			["experience", 0],
			["experience/acme", 1],
			["experience/globex", 1],
		]);
		expect(tree.find((node) => node.path === "experience")).toMatchObject({
			facts: { active: 3, excluded: 1 },
			activeChars: 300,
			status: null,
		});
		expect(tree[0]).toMatchObject({ name: "clearance", status: "excluded" });
	});

	it("keeps a parent's subgroups right under it", () => {
		expect(groupTree([entry("a b", 1, 0), entry("a/b", 1, 0)]).map((node) => node.path)).toEqual(["a", "a/b", "a b"]);
	});
});

describe("GroupsCard", () => {
	beforeEach(() => {
		api.setStatus.mockReset().mockResolvedValue({ updated: 3 });
		api.groups = [entry("experience/acme", 2, 1), entry("clearance", 0, 18, "excluded"), entry(null, 4, 1)];
	});
	afterEach(cleanup);

	it("switches a whole group, subgroups included, and says what's switched off already", async () => {
		render(
			<I18nProvider i18n={i18n}>
				<QueryClientProvider client={new QueryClient()}>
					<GroupsCard />
				</QueryClientProvider>
			</I18nProvider>,
		);
		expect(await screen.findByText(/0 on · 18 off · 0 characters · new facts start off/)).toBeTruthy();
		expect(screen.getByText("Not in a group: 4 on · 1 off")).toBeTruthy();
		// Nothing left to switch off in clearance.
		expect(screen.getByRole("button", { name: "Switch clearance off" }).hasAttribute("disabled")).toBe(true);

		fireEvent.click(screen.getByRole("button", { name: "Switch experience off" }));
		await waitFor(() => expect(api.setStatus).toHaveBeenCalled());
		expect(api.setStatus.mock.calls[0]?.[0]).toEqual({ group: "experience", status: "excluded", subgroups: true });
	});
});

describe("private groups", () => {
	beforeEach(() => {
		api.savePrivacy.mockReset().mockResolvedValue({});
		api.groups = [entry("clearance", 1, 17, "excluded", true), entry("clearance/ts", 0, 1), entry("experience", 3, 0)];
	});
	afterEach(cleanup);

	it("marks subgroups of a private group private too, and makes a group private", async () => {
		render(
			<I18nProvider i18n={i18n}>
				<QueryClientProvider client={new QueryClient()}>
					<GroupsCard />
				</QueryClientProvider>
			</I18nProvider>,
		);
		const subgroup = await screen.findByRole("switch", { name: "Keep clearance/ts private" });
		expect(subgroup.getAttribute("aria-checked")).toBe("true");
		expect(subgroup.hasAttribute("disabled") || subgroup.getAttribute("aria-disabled") === "true").toBe(true);
		expect(screen.getAllByText(/private, never sent unless an application includes it/)).toHaveLength(2);

		fireEvent.click(screen.getByRole("switch", { name: "Keep experience private" }));
		await waitFor(() => expect(api.savePrivacy).toHaveBeenCalled());
		expect(api.savePrivacy.mock.calls[0]?.[0]).toEqual({ group: "experience", private: true });
	});
});
