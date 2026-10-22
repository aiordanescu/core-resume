import { findDuplicates, normalizeFactText } from "@reactive-resume/utils/knowledge";

type Imported = { text: string; source: { id: string } };
export type ImportKnownFact = {
	id: string;
	text: string;
	status: string;
	applicationId: string | null;
	source: { kind: string; id: string };
};
export type ImportDuplicate = {
	target: "knowledge" | "import";
	id: string;
	kind: "source" | "exact" | "near";
	similarity: number;
};
export type ImportDuplicates = Map<string, ImportDuplicate[]>;

/** Compare a file with shared Knowledge using Curate's rules, and compare later file rows with earlier ones. */
export function findImportDuplicates(
	imported: readonly Imported[],
	known: readonly ImportKnownFact[],
): ImportDuplicates {
	const result: ImportDuplicates = new Map();
	const add = (id: string, match: ImportDuplicate) => {
		const matches = result.get(id) ?? [];
		if (!matches.some((item) => item.target === match.target && item.id === match.id)) matches.push(match);
		result.set(id, matches);
	};
	const shared = known.filter((fact) => fact.applicationId === null && fact.status !== "forgotten");
	const byText = new Map<string, ImportKnownFact[]>();
	const bySource = new Map<string, ImportKnownFact[]>();
	for (const fact of shared) {
		const key = normalizeFactText(fact.text);
		if (key) byText.set(key, [...(byText.get(key) ?? []), fact]);
		if (fact.source.kind === "import") bySource.set(fact.source.id, [...(bySource.get(fact.source.id) ?? []), fact]);
	}
	const earlier = new Map<string, string>();
	for (const row of imported) {
		const id = row.source.id;
		for (const fact of bySource.get(id) ?? [])
			add(id, { target: "knowledge", id: fact.id, kind: "source", similarity: 1 });
		const key = normalizeFactText(row.text);
		for (const fact of byText.get(key) ?? [])
			add(id, { target: "knowledge", id: fact.id, kind: "exact", similarity: 1 });
		const first = earlier.get(key);
		if (first && !result.has(id)) add(id, { target: "import", id: first, kind: "exact", similarity: 1 });
		if (key && !first) earlier.set(key, id);
	}

	const inputs = imported.map((row, index) => ({
		id: `import/${row.source.id}`,
		text: row.text,
		applicationId: null,
		status: "active",
		target: "import" as const,
		targetId: row.source.id,
		index,
	}));
	const stored = shared.map((fact) => ({
		id: `knowledge/${fact.id}`,
		text: fact.text,
		applicationId: null,
		status: fact.status,
		target: "knowledge" as const,
		targetId: fact.id,
		index: -1,
	}));
	for (const pair of findDuplicates([...inputs, ...stored]).near) {
		const [left, right] = pair.facts;
		if (left.target === "knowledge" && right.target === "knowledge") continue;
		if (left.target === "import" && right.target === "import") {
			const [later, first] = left.index > right.index ? [left, right] : [right, left];
			add(later.targetId, { target: "import", id: first.targetId, kind: "near", similarity: pair.similarity });
		} else {
			const draft = left.target === "import" ? left : right;
			const fact = left.target === "knowledge" ? left : right;
			add(draft.targetId, { target: "knowledge", id: fact.targetId, kind: "near", similarity: pair.similarity });
		}
	}
	for (const matches of result.values())
		matches.sort(
			(a, b) => Number(b.target === "knowledge") - Number(a.target === "knowledge") || b.similarity - a.similarity,
		);
	return result;
}
