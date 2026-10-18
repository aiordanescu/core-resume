import { describe, expect, it } from "vitest";
import { fillEnGb, fillEnUs } from "./english";

const header = 'msgid ""\nmsgstr ""\n"Language: en-US\\n"\n\n';

describe("en-US from the en-GB source", () => {
	it("fills empty entries and copies of the source, in US spelling and keeping case", () => {
		const po = `${header}msgid "Practise"\nmsgstr ""\n\nmsgid "Recognised colour; ORGANISE it"\nmsgstr "Recognised colour; ORGANISE it"\n`;
		expect(fillEnUs(po)).toBe(
			`${header}msgid "Practise"\nmsgstr "Practice"\n\nmsgid "Recognised colour; ORGANISE it"\nmsgstr "Recognized color; ORGANIZE it"\n`,
		);
	});

	it("keeps an entry that is already translated", () => {
		const po = `${header}msgid "Grey"\nmsgstr "Slate"\n`;
		expect(fillEnUs(po)).toBe(po);
	});

	it("handles multi-line entries, escapes and placeholders", () => {
		const po = `${header}msgid ""\n"Keep practising "\n"\\ncolour {colour}"\nmsgstr ""\n`;
		expect(fillEnUs(po)).toBe(
			`${header}msgid ""\n"Keep practising "\n"\\ncolour {colour}"\nmsgstr ""\n"Keep practicing "\n"\\ncolor {colour}"\n`,
		);
	});

	it("leaves words that are -ise in US English alone, and is idempotent", () => {
		const po = `${header}msgid "Advertise, revise, centre"\nmsgstr ""\n`;
		const filled = fillEnUs(po);
		expect(filled).toContain('msgstr "Advertise, revise, center"');
		expect(fillEnUs(filled)).toBe(filled);
	});

	it("never touches the catalog header", () => {
		expect(fillEnUs(header)).toBe(header);
	});
});

describe("en-GB from the source", () => {
	it("fills only empty entries, with the source as it is", () => {
		const po = `${header}msgid "Practise colour"\nmsgstr ""\n\nmsgid "Color"\nmsgstr "Colour"\n\nmsgid "Grey"\nmsgstr "Grey"\n`;
		expect(fillEnGb(po)).toBe(
			`${header}msgid "Practise colour"\nmsgstr "Practise colour"\n\nmsgid "Color"\nmsgstr "Colour"\n\nmsgid "Grey"\nmsgstr "Grey"\n`,
		);
	});
});
