// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import Cookies from "js-cookie";

const router = vi.hoisted(() => ({ invalidate: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({ useRouter: () => router }));

i18n.loadAndActivate({ locale: "en", messages: {} });

const { PaletteTiles } = await import("./palette");
const { ThemeProvider } = await import("@/features/theme/provider");
const { getPalette } = await import("@/libs/theme");

function renderTiles(palette: "cobalt" | "original") {
	render(
		<I18nProvider i18n={i18n}>
			<ThemeProvider theme="light" palette={palette}>
				<PaletteTiles />
			</ThemeProvider>
		</I18nProvider>,
	);
}

const themeColors = () =>
	[...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((meta) => meta.content);

describe("Palette", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Cookies.remove("palette");
		delete document.documentElement.dataset.palette;
		document.head.innerHTML =
			'<meta name="theme-color" media="(prefers-color-scheme: light)" content="" />' +
			'<meta name="theme-color" media="(prefers-color-scheme: dark)" content="" />';
	});

	it("applies the saved palette and checks its tile", () => {
		renderTiles("cobalt");

		expect(document.documentElement.dataset.palette).toBe("cobalt");
		expect(themeColors()).toEqual(["#F6F8FA", "#0D1117"]);
		expect((screen.getByRole("radio", { name: /Cobalt/ }) as HTMLInputElement).checked).toBe(true);
		expect(screen.getByText("GitHub chrome, blue accent")).toBeTruthy();
	});

	it("switches to Original at once and remembers it", () => {
		renderTiles("cobalt");

		fireEvent.click(screen.getByRole("radio", { name: /Original/ }));

		expect(document.documentElement.dataset.palette).toBe("original");
		expect(themeColors()).toEqual(["#F8F7F3", "#100F0C"]);
		expect(Cookies.get("palette")).toBe("original");
		expect(router.invalidate).toHaveBeenCalled();
	});

	it("defaults to Cobalt without a valid saved palette", () => {
		expect(getPalette()).toBe("cobalt");
		Cookies.set("palette", "sepia");
		expect(getPalette()).toBe("cobalt");
		Cookies.set("palette", "original");
		expect(getPalette()).toBe("original");
	});
});
