import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import Cookies from "js-cookie";
import z from "zod";

const themeSchema = z.union([z.literal("light"), z.literal("dark"), z.literal("system")]);

/** The appearance the person chose. "system" follows the operating system. */
export type Theme = z.infer<typeof themeSchema>;
/** The appearance actually on screen. */
export type ResolvedTheme = "light" | "dark";

const storageKey = "theme";
const defaultTheme: Theme = "system";

export const systemDarkQuery = "(prefers-color-scheme: dark)";

export const themeMap = {
	light: msg`Light`,
	dark: msg`Dark`,
	system: msg`System`,
} satisfies Record<Theme, MessageDescriptor>;

export function isTheme(theme: string): theme is Theme {
	return themeSchema.safeParse(theme).success;
}

export function resolveTheme(theme: Theme, systemPrefersDark: boolean): ResolvedTheme {
	if (theme === "system") return systemPrefersDark ? "dark" : "light";
	return theme;
}

export const getTheme = () => {
	const theme = Cookies.get(storageKey);
	if (!theme || !isTheme(theme)) return defaultTheme;
	return theme;
};

export const setThemeCookie = (theme: Theme) => {
	Cookies.set(storageKey, theme);
};

const paletteSchema = z.union([z.literal("cobalt"), z.literal("original")]);

/** The app's colors, applied on top of the light or dark appearance. Original is upstream's warm paper, with the brand blue in place of its green. */
export type Palette = z.infer<typeof paletteSchema>;

const paletteStorageKey = "palette";
export const defaultPalette: Palette = "cobalt";

export const paletteMap = {
	cobalt: { name: msg`Cobalt`, description: msg`GitHub chrome, blue accent` },
	original: { name: msg`Original`, description: msg`Warm paper tones, blue accent` },
} satisfies Record<Palette, { name: MessageDescriptor; description: MessageDescriptor }>;

/** The browser bar color for each palette and appearance, matching `--bg`. index.html starts with Cobalt's. */
export const paletteThemeColors = {
	cobalt: { light: "#F6F8FA", dark: "#0D1117" },
	original: { light: "#F8F7F3", dark: "#100F0C" },
} satisfies Record<Palette, Record<ResolvedTheme, string>>;

export function isPalette(palette: string): palette is Palette {
	return paletteSchema.safeParse(palette).success;
}

export const getPalette = () => {
	const palette = Cookies.get(paletteStorageKey);
	if (!palette || !isPalette(palette)) return defaultPalette;
	return palette;
};

export const setPaletteCookie = (palette: Palette) => {
	Cookies.set(paletteStorageKey, palette);
};
