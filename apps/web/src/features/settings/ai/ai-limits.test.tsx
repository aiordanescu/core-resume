// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { aiLimitsSchema } from "@reactive-resume/schema/career";

const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
const toasts = vi.hoisted(() => ({ add: vi.fn() }));

vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		career: {
			aiLimits: {
				queryKey: () => ["ai-limits"],
				queryOptions: () => ({ queryKey: ["ai-limits"], queryFn: api.get }),
			},
			saveAiLimits: {
				mutationOptions: (options: object) => ({ mutationFn: api.save, ...options }),
			},
		},
	},
}));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: toasts.add, close: vi.fn() } }));

i18n.loadAndActivate({ locale: "en", messages: {} });

const { AiLimitsForm, AiLimitsSection } = await import("./ai-limits");

const defaults = aiLimitsSchema.parse({});

function renderSection() {
	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
				<AiLimitsSection />
			</QueryClientProvider>
		</I18nProvider>,
	);
}

describe("AI limits", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		api.get.mockResolvedValue(defaults);
		api.save.mockImplementation(async (limits: unknown) => limits);
	});

	it("saves every limit after one is raised", async () => {
		renderSection();
		const facts = await screen.findByLabelText("Facts shared with each message");
		const save = screen.getByRole("button", { name: "Save" });
		expect(save.hasAttribute("disabled")).toBe(true);

		fireEvent.change(facts, { target: { value: "200" } });
		fireEvent.click(save);

		await waitFor(() => expect(api.save).toHaveBeenCalled());
		expect(api.save.mock.calls[0]?.[0]).toEqual({ ...defaults, coachFacts: 200 });
		await waitFor(() => expect(toasts.add).toHaveBeenCalledWith(expect.objectContaining({ type: "success" })));
	});

	it("won't save a limit outside its range, and Reset puts the defaults back", async () => {
		api.get.mockResolvedValue({ ...defaults, actionFactChars: 50_000 });
		renderSection();
		const budget = await screen.findByLabelText("Facts in each action");
		expect((budget as HTMLInputElement).value).toBe("50000");

		fireEvent.change(budget, { target: { value: "500" } });
		expect(budget.getAttribute("aria-invalid")).toBe("true");
		expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);

		fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
		expect((budget as HTMLInputElement).value).toBe("10000");
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(api.save.mock.calls[0]?.[0]).toEqual(defaults));
	});

	it("saves a longer time limit for application actions and replies", async () => {
		renderSection();
		fireEvent.change(await screen.findByLabelText("Time limit for Fit, Apply and other actions"), {
			target: { value: "600" },
		});
		fireEvent.change(screen.getByLabelText("Time limit for a whole Coach or Assistant reply"), {
			target: { value: "720" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() =>
			expect(api.save.mock.calls[0]?.[0]).toEqual({ ...defaults, actionTimeoutSeconds: 600, replyTimeoutSeconds: 720 }),
		);
	});

	it("saves only its own limits from another section, keeping the rest as last saved", async () => {
		api.get.mockResolvedValue({ ...defaults, coachFacts: 99 });
		render(
			<I18nProvider i18n={i18n}>
				<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
					<AiLimitsForm
						groups={[
							{ legend: "Time limits", limits: [{ name: "webCallTimeoutSeconds", label: "Web call", unit: "s" }] },
						]}
					/>
				</QueryClientProvider>
			</I18nProvider>,
		);
		fireEvent.change(await screen.findByLabelText("Web call"), { target: { value: "45" } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() =>
			expect(api.save.mock.calls[0]?.[0]).toEqual({ ...defaults, coachFacts: 99, webCallTimeoutSeconds: 45 }),
		);
	});
});
