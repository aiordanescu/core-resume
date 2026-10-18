/**
 * The interface's source text is plain English, mostly British spelling with some US, so the source locale is "en" and
 * both English catalogs are translations. Nobody translates English into English, so this fills them after
 * `pnpm lingui:extract`: en-US entries that are empty, or still a copy of the source, get the source in US spelling;
 * en-GB entries that are empty get the source as it is (upstream's translators keep British spellings there). An entry
 * that differs from the source is a real translation and is kept. Fork-only.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Stems spelled -ise in British English and -ize in US English. Words that are -ise in both (advertise, advise,
// exercise, expertise, promise, revise, supervise, surprise and the like) are deliberately absent.
const IZE_STEMS = [
	"apolog",
	"author",
	"capital",
	"categor",
	"central",
	"character",
	"custom",
	"emphas",
	"final",
	"general",
	"initial",
	"ital",
	"maxim",
	"memor",
	"minim",
	"normal",
	"optim",
	"organ",
	"personal",
	"priorit",
	"real",
	"recogn",
	"standard",
	"summar",
	"synchron",
	"util",
	"visual",
];
const IZE_ENDINGS = [
	["ise", "ize"],
	["ised", "ized"],
	["ises", "izes"],
	["ising", "izing"],
	["isation", "ization"],
	["isations", "izations"],
	["iser", "izer"],
	["isers", "izers"],
	["isable", "izable"],
];

const WORDS: Record<string, string> = {
	practise: "practice",
	practised: "practiced",
	practises: "practices",
	practising: "practicing",
	analyse: "analyze",
	analysed: "analyzed",
	analyses: "analyzes",
	analysing: "analyzing",
	colour: "color",
	colours: "colors",
	coloured: "colored",
	favour: "favor",
	favourite: "favorite",
	favourites: "favorites",
	behaviour: "behavior",
	behaviours: "behaviors",
	honour: "honor",
	labour: "labor",
	neighbour: "neighbor",
	centre: "center",
	centres: "centers",
	centred: "centered",
	metre: "meter",
	metres: "meters",
	licence: "license",
	licences: "licenses",
	defence: "defense",
	offence: "offense",
	grey: "gray",
	catalogue: "catalog",
	catalogues: "catalogs",
	judgement: "judgment",
	enrol: "enroll",
	enrolment: "enrollment",
	fulfil: "fulfill",
	fulfilment: "fulfillment",
	cancelled: "canceled",
	cancelling: "canceling",
	travelled: "traveled",
	travelling: "traveling",
	modelled: "modeled",
	modelling: "modeling",
	labelled: "labeled",
	labelling: "labeling",
	levelled: "leveled",
	signalled: "signaled",
	...Object.fromEntries(IZE_STEMS.flatMap((stem) => IZE_ENDINGS.map(([gb, us]) => [stem + gb, stem + us]))),
};

/** US spelling of one word, keeping its capitalization. */
const toUs = (word: string) => {
	const us = WORDS[word.toLowerCase()];
	if (!us) return word;
	if (word === word.toUpperCase() && word.length > 1) return us.toUpperCase();
	return word[0] === word[0]?.toUpperCase() ? (us[0]?.toUpperCase() ?? "") + us.slice(1) : us;
};

/**
 * The words of PO string lines in US spelling. Quotes, escapes (`\n`) and {placeholders} are kept as they are, so a
 * variable name is never rewritten.
 */
const americanizeLines = (lines: string) =>
	lines.replace(/("|\\.|\{[^}]*\})|[A-Za-z]+/g, (token, kept: string | undefined) => (kept ? token : toUs(token)));

type Fill = (source: string) => string;

/** Fills a catalog's entries that are empty (and, with `copies`, identical to the source) from the source lines. */
function fill(po: string, from: Fill, copies: boolean) {
	return po.replace(
		/^(msgid ((?:".*"\n)+))msgstr ((?:".*"\n?)+)/gm,
		(entry, head: string, id: string, translation: string) => {
			const text = (lines: string) => [...lines.matchAll(/"(.*)"/g)].map((line) => line[1]).join("");
			if (text(id) === "") return entry; // the catalog header
			const translated = text(translation);
			if (translated !== "" && !(copies && translated === text(id))) return entry;
			return `${head}msgstr ${from(id)}`;
		},
	);
}

/** en-US: empty entries and copies of the source become the source in US spelling. */
export const fillEnUs = (po: string) => fill(po, americanizeLines, true);

/** en-GB: empty entries become the source as it is. */
export const fillEnGb = (po: string) => fill(po, (source) => source, false);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	for (const [locale, apply] of [
		["en-US", fillEnUs],
		["en-GB", fillEnGb],
	] as const) {
		const path = fileURLToPath(new URL(`../../apps/web/locales/${locale}.po`, import.meta.url));
		const before = await readFile(path, "utf8");
		const after = apply(before);
		if (after !== before) await writeFile(path, after);
		console.log(`${locale}.po: ${after === before ? "nothing to fill" : "filled from the source"}`);
	}
}
