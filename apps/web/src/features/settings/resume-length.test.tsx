// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const auth = vi.hoisted(() => ({ updateUser: vi.fn(), resumePages: 1 }));
const router = vi.hoisted(() => ({ invalidate: vi.fn() }));

vi.mock("@/libs/auth/client", () => ({ authClient: { updateUser: auth.updateUser } }));
vi.mock("@tanstack/react-router", () => ({
	useRouter: () => router,
	useRouteContext: () => ({ session: { user: { resumePages: auth.resumePages } } }),
}));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn(), close: vi.fn() } }));

i18n.loadAndActivate({ locale: "en", messages: {} });

const { ResumeLengthSection } = await import("./resume-length");

function renderSection() {
	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={new QueryClient()}>
				<ResumeLengthSection />
			</QueryClientProvider>
		</I18nProvider>,
	);
	return screen.getByLabelText("Pages per resume");
}

describe("Resume length", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		auth.resumePages = 1;
		auth.updateUser.mockResolvedValue({ error: null });
	});

	it("shows the saved length and saves a new one on blur", async () => {
		const input = renderSection();
		expect((input as HTMLInputElement).value).toBe("1");

		fireEvent.change(input, { target: { value: "2" } });
		fireEvent.blur(input);

		await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ resumePages: 2 }));
		expect(router.invalidate).toHaveBeenCalled();
	});

	it("refuses lengths outside 1 to 99", () => {
		const input = renderSection();

		for (const value of ["0", "100", "1.5", ""]) {
			fireEvent.change(input, { target: { value } });
			fireEvent.blur(input);
			expect(screen.getByText("Enter a whole number from 1 to 99.")).toBeTruthy();
		}
		expect(auth.updateUser).not.toHaveBeenCalled();
	});

	it("doesn't save when the length is unchanged", () => {
		auth.resumePages = 2;
		const input = renderSection();
		fireEvent.blur(input);
		expect(auth.updateUser).not.toHaveBeenCalled();
	});
});
