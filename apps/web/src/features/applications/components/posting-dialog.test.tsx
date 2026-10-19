// @vitest-environment happy-dom
import type { Application } from "../types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { ViewPostingButton } from "./posting-dialog";

const posting = {
	role: "Engineer",
	company: "Harbor",
	sourceUrl: null,
	jobDescription: null,
	postingSource: null,
	requirements: [],
} as unknown as Application;

beforeEach(() => i18n.loadAndActivate({ locale: "en-US", messages: {} }));
afterEach(cleanup);

function mount(application: Partial<Application>) {
	return render(
		<I18nProvider i18n={i18n}>
			<ViewPostingButton application={{ ...posting, ...application }} />
		</I18nProvider>,
	);
}

it("opens the saved description in a dialog, with the link inside", async () => {
	mount({ sourceUrl: "https://jobs.example.com/1", jobDescription: "Run the platform." });
	expect(screen.queryByRole("link", { name: /View posting/ })).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "View posting" }));
	expect(await screen.findByRole("dialog")).toHaveTextContent("Run the platform.");
	expect(screen.getByRole("link", { name: "https://jobs.example.com/1" })).toHaveAttribute("target", "_blank");
});

it("links straight to the posting when only its link was saved", () => {
	mount({ sourceUrl: "https://jobs.example.com/2" });
	const link = screen.getByRole("link", { name: /View posting/ });
	expect(link).toHaveAttribute("href", "https://jobs.example.com/2");
	expect(link).toHaveAttribute("target", "_blank");
});

it("shows nothing when there is no posting", () => {
	const { container } = mount({});
	expect(container).toBeEmptyDOMElement();
});
