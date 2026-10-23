import { describe, expect, it } from "vitest";
import { findImportDuplicates, type ImportKnownFact } from "./import-duplicates";

const draft = (id: string, text: string) => ({ text, source: { id } });
const known = (id: string, text: string, change: Partial<ImportKnownFact> = {}): ImportKnownFact => ({
	id,
	text,
	applicationId: null,
	status: "active",
	source: { kind: "manual", id },
	...change,
});

describe("findImportDuplicates", () => {
	it("finds exact and near matches using Curate's rules, excluding unrelated and application-only facts", () => {
		const rows = [
			draft("a", "PLATFORM ENGINEER!"),
			draft("b", "I built deployment tools and improved incident handoffs."),
		];
		const matches = findImportDuplicates(rows, [
			known("exact", "Platform engineer"),
			known("near", "I built deployment tools and improved incident handoffs for multiple teams."),
			known("unrelated", "I trained retail cashiers."),
			known("private", rows[1]?.text ?? "", { applicationId: "private-job" }),
		]);
		expect(matches.get("a")).toEqual([{ target: "knowledge", id: "exact", kind: "exact", similarity: 1 }]);
		expect(matches.get("b")).toEqual([expect.objectContaining({ target: "knowledge", id: "near", kind: "near" })]);
	});

	it("matches corrected sources and archived exact copies without exposing forgotten facts", () => {
		const matches = findImportDuplicates(
			[draft("source", "Old wording"), draft("retired", "Retired skill")],
			[
				known("corrected", "Corrected wording", { source: { kind: "import", id: "source" } }),
				known("archived", "Retired skill", { status: "archived" }),
				known("forgotten", "Old wording", { status: "forgotten" }),
			],
		);
		expect(matches.get("source")).toEqual([{ target: "knowledge", id: "corrected", kind: "source", similarity: 1 }]);
		expect(matches.get("retired")).toEqual([{ target: "knowledge", id: "archived", kind: "exact", similarity: 1 }]);
	});

	it("keeps the first file occurrence as a candidate and compares later copies with it", () => {
		const matches = findImportDuplicates(
			[
				draft("first", "I built deployment tools and improved incident handoffs."),
				draft("second", "I built deployment tools and improved incident handoffs!"),
				draft("third", "I built deployment tools and improved incident handoffs for multiple teams."),
			],
			[],
		);
		expect(matches.has("first")).toBe(false);
		expect(matches.get("second")).toEqual([{ target: "import", id: "first", kind: "exact", similarity: 1 }]);
		expect(matches.get("third")).toContainEqual(
			expect.objectContaining({ target: "import", id: "first", kind: "near" }),
		);
	});
});
