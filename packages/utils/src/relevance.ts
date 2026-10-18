/**
 * Keyword relevance (BM25) for ordering Knowledge against a posting or a question, with no model call. Matches words,
 * not meaning: callers rank with it and keep what doesn't match, so a fact worded differently still has a place.
 */

const K1 = 1.2;
const B = 0.75;
/** Saturates repeats in the query, so a term a posting names five times counts more than once, not five times. */
const K3 = 1.2;

// Common English words, plus posting filler that says nothing about the work itself.
const STOPWORDS = new Set(
	`a about above after again against all also am an and any are as at be because been before being below between both
	but by can could did do does doing down during each etc few for from further had has have having he her here hers him
	his how i if in into is it its itself just me more most my no nor not now of off on once only or other our ours out
	over own same she should so some such than that the their theirs them then there these they this those through to too
	under until up very via was we were what when where which while who whom why will with would you your yours
	ability able across based best candidate candidates experience experienced familiarity including ideal knowledge least
	like looking must plus preferred proficiency proven qualifications related required requirements responsibilities role
	skills strong understanding using well within work working year years`.split(/\s+/),
);

/** A light English stemmer: enough that "migrated", "migrating" and "migration" meet. Only plain words are stemmed. */
export function stem(word: string) {
	if (word.length <= 4 || /[^\p{L}]/u.test(word)) return word;
	let w = word;
	const cut = (suffix: string, replacement = "") => {
		if (!w.endsWith(suffix) || w.length - suffix.length < 3) return false;
		w = w.slice(0, -suffix.length) + replacement;
		return true;
	};
	if (!cut("ies", "y") && !cut("sses", "ss") && !/(ss|us|is)$/.test(w)) cut("s");
	// The first derivational suffix that applies, then a trailing "e", so "migrate" meets "migration".
	for (const [suffix, replacement] of [["ation", "at"], ["ment"], ["ing"], ["ed"], ["ly"]] as const)
		if (cut(suffix, replacement)) break;
	cut("e");
	return w;
}

/** Lowercased, accent-free word stems, without stopwords. Keeps tokens like "c#", "c++", "node.js" and "k8s" whole. */
export function terms(text: string) {
	const words = text
		.toLocaleLowerCase()
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.match(/[\p{L}\p{N}](?:[\p{L}\p{N}.]*[\p{L}\p{N}])?[+#]*/gu);
	return (words ?? []).filter((word) => word.length > 1 && !STOPWORDS.has(word)).map(stem);
}

const counts = (tokens: string[]) => {
	const map = new Map<string, number>();
	for (const token of tokens) map.set(token, (map.get(token) ?? 0) + 1);
	return map;
};

/** Each item's BM25 score against the query, in item order; 0 means no shared terms. */
export function relevanceScores<T>(items: readonly T[], text: (item: T) => string, query: string) {
	const queryTerms = counts(terms(query));
	if (queryTerms.size === 0 || items.length === 0) return items.map(() => 0);

	const documents = items.map((item) => counts(terms(text(item))));
	const lengths = documents.map((document) => [...document.values()].reduce((sum, n) => sum + n, 0));
	const average = lengths.reduce((sum, n) => sum + n, 0) / items.length || 1;
	const frequency = new Map<string, number>();
	for (const document of documents)
		for (const term of document.keys()) if (queryTerms.has(term)) frequency.set(term, (frequency.get(term) ?? 0) + 1);

	return documents.map((document, index) => {
		let score = 0;
		const norm = K1 * (1 - B + (B * (lengths[index] ?? 0)) / average);
		for (const [term, inQuery] of queryTerms) {
			const tf = document.get(term);
			if (!tf) continue;
			const df = frequency.get(term) ?? 0;
			const idf = Math.log(1 + (items.length - df + 0.5) / (df + 0.5));
			score += idf * ((tf * (K1 + 1)) / (tf + norm)) * (((K3 + 1) * inQuery) / (K3 + inQuery));
		}
		return score;
	});
}

/**
 * The items ordered by relevance to the query, best first. Ties, including everything that shares no terms, keep their
 * original order, and nothing is dropped. An empty query returns the items as they were.
 */
export function rankByRelevance<T>(items: readonly T[], text: (item: T) => string, query: string): T[] {
	const scores = relevanceScores(items, text, query);
	return items
		.map((item, index) => ({ item, index, score: scores[index] ?? 0 }))
		.sort((a, b) => b.score - a.score || a.index - b.index)
		.map(({ item }) => item);
}

type StoryText = { title: string; situation: string; task: string; action: string; result: string; reflection: string };

/** The words of a STARR story that relevance looks at. */
export const storyText = (story: StoryText & { tags?: readonly string[] }) =>
	[story.title, story.situation, story.task, story.action, story.result, story.reflection, ...(story.tags ?? [])].join(
		"\n",
	);

type PostingText = { role: string; jobDescription?: string | null; requirements?: readonly string[] | null };

/**
 * What the coach ranks Knowledge against for a message: the message, plus the posting when the application is shared.
 * The web app records the facts and stories a message shared from the same query, so both sides must build it here.
 */
export const coachQuery = (message: string, application: PostingText | null | undefined) =>
	[message, application?.role, application?.jobDescription, ...(application?.requirements ?? [])]
		.filter(Boolean)
		.join("\n");
