import type { Palette, ResolvedTheme, Theme } from "@/libs/theme";
import type { PropsWithChildren } from "react";
import { useRouter } from "@tanstack/react-router";
import { createContext, use, useEffect, useSyncExternalStore } from "react";
import { paletteThemeColors, resolveTheme, setPaletteCookie, setThemeCookie, systemDarkQuery } from "@/libs/theme";

type ThemeContextValue = {
	/** The chosen appearance, including "system". */
	theme: Theme;
	/** What's on screen right now. */
	resolvedTheme: ResolvedTheme;
	setTheme: (value: Theme, options?: { playSound?: boolean }) => void;
	toggleTheme: (options?: { playSound?: boolean }) => void;
	/** The app's colors, on top of the appearance. */
	palette: Palette;
	setPalette: (value: Palette) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const subscribeToSystemTheme = (onChange: () => void) => {
	const query = window.matchMedia(systemDarkQuery);
	query.addEventListener("change", onChange);
	return () => query.removeEventListener("change", onChange);
};
const systemPrefersDark = () => window.matchMedia(systemDarkQuery).matches;

// Swap the theme class or palette with transitions suppressed for one frame, so every color changes at once
// instead of each element easing between palettes on its own schedule.
function withoutTransitions(change: () => void) {
	const style = document.createElement("style");
	style.textContent = "*,*::before,*::after{transition:none!important}";
	document.head.append(style);

	change();
	void window.getComputedStyle(document.documentElement).color; // force a style flush while transitions are off
	setTimeout(() => style.remove(), 1); // rAF would never fire in a hidden tab, leaving transitions off
}

function applyThemeClass(theme: ResolvedTheme) {
	const root = document.documentElement;
	const isDark = theme === "dark";
	if (root.classList.contains("dark") === isDark) return;

	withoutTransitions(() => root.classList.toggle("dark", isDark));
}

function applyPalette(palette: Palette) {
	const root = document.documentElement;
	if (root.dataset.palette !== palette) withoutTransitions(() => (root.dataset.palette = palette));

	for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
		const mode = meta.getAttribute("media")?.includes("dark") ? "dark" : "light";
		meta.content = paletteThemeColors[palette][mode];
	}
}

type Props = PropsWithChildren<{ theme: Theme; palette: Palette }>;

export function ThemeProvider({ children, theme, palette }: Props) {
	const router = useRouter();
	const prefersDark = useSyncExternalStore(subscribeToSystemTheme, systemPrefersDark, () => false);
	const resolvedTheme = resolveTheme(theme, prefersDark);

	useEffect(() => {
		applyThemeClass(resolvedTheme);
	}, [resolvedTheme]);

	useEffect(() => {
		applyPalette(palette);
	}, [palette]);

	async function setTheme(value: Theme, options: { playSound?: boolean } = {}) {
		const { playSound = true } = options;
		const next = resolveTheme(value, systemPrefersDark());

		applyThemeClass(next);
		setThemeCookie(value);
		void router.invalidate();

		if (!playSound) return;

		const soundClip = next === "dark" ? "/sounds/switch-off.mp3" : "/sounds/switch-on.mp3";
		try {
			const audio = new Audio(soundClip);
			await audio.play();
		} catch {
			// ignore errors
		}
	}

	function toggleTheme(options: { playSound?: boolean } = {}) {
		void setTheme(resolvedTheme === "dark" ? "light" : "dark", options);
	}

	function setPalette(value: Palette) {
		applyPalette(value);
		setPaletteCookie(value);
		void router.invalidate();
	}

	return (
		<ThemeContext value={{ theme, resolvedTheme, setTheme, toggleTheme, palette, setPalette }}>{children}</ThemeContext>
	);
}

export function useTheme() {
	const value = use(ThemeContext);

	if (!value) throw new Error("useTheme must be used within a ThemeProvider");

	return value;
}
