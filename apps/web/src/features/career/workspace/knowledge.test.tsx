// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({ data: {} as Record<string, unknown>, save: vi.fn(), remove: vi.fn() }));
vi.mock("@/libs/orpc/client", () => {
	const endpoint = (name: string) => ({
		key: () => [name],
		queryOptions: () => ({ queryKey: [name], queryFn: async () => api.data[name], retry: false }),
		mutationOptions: () => ({ mutationFn: name === "deleteOverride" ? api.remove : api.save }),
	});
	return {
		orpc: {
			career: Object.fromEntries(
				["factGroups", "overrides", "facts", "savedItems", "saveOverride", "deleteOverride"].map((name) => [
					name,
					endpoint(name),
				]),
			),
		},
	};
});
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn() } }));
vi.mock("../shared", () => ({ Eyebrow: ({ children }: { children: ReactNode }) => <p>{children}</p> }));

i18n.loadAndActivate({ locale: "en", messages: {} });
const { ApplicationKnowledge } = await import("./knowledge");

const group = (name: string, isPrivate = false) => ({
	group: name,
	status: null,
	private: isPrivate,
	facts: { active: 1, excluded: 0 },
	activeChars: 10,
});
const mount = () =>
	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={new QueryClient()}>
				<ApplicationKnowledge applicationId="federal" />
			</QueryClientProvider>
		</I18nProvider>,
	);

describe("Knowledge for one job", () => {
	beforeEach(() => {
		api.save.mockReset().mockResolvedValue({});
		api.remove.mockReset().mockResolvedValue(undefined);
		api.data = { factGroups: [group("clearance", true), group("experience")], overrides: [], facts: [] };
	});
	afterEach(cleanup);

	it("includes a private group for this job with one switch, and takes it back out", async () => {
		mount();
		fireEvent.click(await screen.findByRole("switch", { name: "Include clearance for this job" }));
		await waitFor(() => expect(api.save).toHaveBeenCalled());
		expect(api.save.mock.calls[0]?.[0]).toEqual({ applicationId: "federal", group: "clearance", mode: "include" });

		cleanup();
		api.data.overrides = [{ id: "o1", applicationId: "federal", group: "clearance", factId: null, mode: "include" }];
		mount();
		expect(await screen.findByText("Included for this job")).toBeTruthy();
		fireEvent.click(screen.getByRole("switch", { name: "Include clearance for this job" }));
		await waitFor(() => expect(api.remove).toHaveBeenCalled());
		expect(api.remove.mock.calls[0]?.[0]).toEqual({ id: "o1" });
	});

	it("leaves out another group for this job, and lists fact overrides by their text", async () => {
		api.data.overrides = [{ id: "o2", applicationId: "federal", group: null, factId: "f1", mode: "exclude" }];
		api.data.facts = [{ id: "f1", text: "I led the Acme migration." }];
		mount();
		expect(await screen.findByText("I led the Acme migration.")).toBeTruthy();
		expect(screen.getByText("Left out for this job")).toBeTruthy();
		fireEvent.change(screen.getByRole("combobox", { name: "Another group" }), { target: { value: "experience" } });
		fireEvent.click(screen.getByRole("button", { name: "Leave out" }));
		await waitFor(() => expect(api.save).toHaveBeenCalled());
		expect(api.save.mock.calls[0]?.[0]).toEqual({ applicationId: "federal", group: "experience", mode: "exclude" });
	});

	it("shows nothing without any groups", async () => {
		api.data.factGroups = [];
		const { container } = mount();
		await waitFor(() => expect(container.textContent).toBe(""));
	});
});
