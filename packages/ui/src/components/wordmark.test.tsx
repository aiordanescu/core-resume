import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { APP_NAME } from "@reactive-resume/utils/brand";
import { Logomark, Wordmark } from "./wordmark";

describe("Wordmark", () => {
	it("is an image named after the app, sized from its height", () => {
		render(<Wordmark variant="stacked" height={130} />);
		const logo = screen.getByRole("img", { name: APP_NAME });
		expect(logo).toHaveAttribute("viewBox", "0 0 140 130");
		expect(logo).toHaveAttribute("height", "130");
		expect(logo).toHaveAttribute("width", "140");
	});

	it("keeps each variant's proportions", () => {
		const { rerender } = render(<Wordmark height={30} />);
		expect(screen.getByRole("img")).toHaveAttribute("width", "170");

		rerender(<Wordmark variant="beside" height={53} />);
		expect(screen.getByRole("img")).toHaveAttribute("width", "166");
	});

	it("paints the mark and 'work' in the brand color and 'allthat' in the text color", () => {
		const { container } = render(<Wordmark variant="stacked" />);
		expect(container.querySelectorAll(".fill-brand")).toHaveLength(2);
		expect(container.querySelectorAll(".fill-current")).toHaveLength(1);
	});

	it("can be hidden when its link already carries the name", () => {
		render(<Wordmark aria-hidden="true" />);
		expect(screen.queryByRole("img")).not.toBeInTheDocument();
	});
});

describe("Logomark", () => {
	it("draws the asterisk alone at the given size", () => {
		const { container } = render(<Logomark size={32} />);
		const mark = screen.getByRole("img", { name: APP_NAME });
		expect(mark).toHaveAttribute("width", "32");
		expect(container.querySelectorAll("path")).toHaveLength(1);
	});
});
