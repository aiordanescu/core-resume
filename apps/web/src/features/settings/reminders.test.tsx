// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const auth = vi.hoisted(() => ({ updateUser: vi.fn(), noReplyDays: 10, interviewReminders: true }));
const router = vi.hoisted(() => ({ invalidate: vi.fn() }));

vi.mock("@/libs/auth/client", () => ({ authClient: { updateUser: auth.updateUser } }));
vi.mock("@tanstack/react-router", () => ({
	useRouter: () => router,
	useRouteContext: () => ({
		session: { user: { noReplyDays: auth.noReplyDays, interviewReminders: auth.interviewReminders } },
	}),
}));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn(), close: vi.fn() } }));

i18n.loadAndActivate({ locale: "en", messages: {} });

const { RemindersSection } = await import("./reminders");

function renderSection() {
	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={new QueryClient()}>
				<RemindersSection />
			</QueryClientProvider>
		</I18nProvider>,
	);
	return {
		nudges: screen.getByRole("switch", { name: "Follow-up nudges" }),
		days: screen.getByLabelText("Days without a reply") as HTMLInputElement,
		interview: screen.getByRole("switch", { name: "Next interview" }),
	};
}

describe("Reminders", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		auth.noReplyDays = 10;
		auth.interviewReminders = true;
		auth.updateUser.mockResolvedValue({ error: null });
	});

	it("turns the follow-up nudge off by saving 0 days", async () => {
		const { nudges } = renderSection();
		fireEvent.click(nudges);
		await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ noReplyDays: 0 }));
		expect(router.invalidate).toHaveBeenCalled();
	});

	it("turns it back on at the default when it was off", async () => {
		auth.noReplyDays = 0;
		const { nudges, days } = renderSection();
		expect(days.disabled).toBe(true);
		fireEvent.click(nudges);
		await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ noReplyDays: 10 }));
	});

	it("saves a new number of days on blur and refuses ones out of range", async () => {
		const { days } = renderSection();
		for (const value of ["0", "91", "2.5", ""]) {
			fireEvent.change(days, { target: { value } });
			fireEvent.blur(days);
			expect(screen.getByText("Enter a whole number of days from 1 to 90.")).toBeTruthy();
		}
		expect(auth.updateUser).not.toHaveBeenCalled();

		fireEvent.change(days, { target: { value: "21" } });
		fireEvent.blur(days);
		await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ noReplyDays: 21 }));
	});

	it("switches the next-interview card off", async () => {
		const { interview } = renderSection();
		fireEvent.click(interview);
		await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ interviewReminders: false }));
	});
});
