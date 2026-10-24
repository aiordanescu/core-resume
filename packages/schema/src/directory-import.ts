import z from "zod";
import { directoryKey } from "./directory";

/** LinkedIn vanity URLs are the connection's source identity, independent of tracking parameters and locale host. */
export function linkedInProfileKey(value: string): string | null {
	try {
		const url = new URL(value.trim());
		if (
			!/^https?:$/.test(url.protocol) ||
			url.username ||
			url.password ||
			url.port ||
			!/^(?:[a-z]{2,3}\.)?linkedin\.com$/i.test(url.hostname)
		)
			return null;
		const match = /^\/in\/([^/]+)\/?$/.exec(url.pathname);
		if (!match?.[1]) return null;
		const slug = decodeURIComponent(match[1]).normalize("NFC").toLowerCase();
		if (!slug || /[\s/\\?#]/.test(slug)) return null;
		return `https://www.linkedin.com/in/${encodeURIComponent(slug)}`;
	} catch {
		return null;
	}
}

export const linkedInConnectionSchema = z.object({
	name: z.string().trim().min(1).max(200),
	profileUrl: z
		.string()
		.max(2048)
		.refine((value) => linkedInProfileKey(value) !== null, "Use a LinkedIn profile URL.")
		.transform((value) => linkedInProfileKey(value) ?? value),
	company: z.string().trim().max(300).default(""),
	position: z.string().trim().max(300).default(""),
	email: z.union([z.literal(""), z.email().max(320)]).default(""),
	connectedOn: z.iso.date().nullable().default(null),
});
export type LinkedInConnection = z.infer<typeof linkedInConnectionSchema>;

export const linkedInCompanyChoiceSchema = z.object({
	sourceName: z.string().trim().min(1).max(300),
	companyId: z.string().min(1).nullable(),
	name: z.string().trim().min(1).max(300),
});
export type LinkedInCompanyChoice = z.infer<typeof linkedInCompanyChoiceSchema>;

export const linkedInImportSchema = z.object({
	importEmails: z.boolean().default(false),
	companies: z.array(linkedInCompanyChoiceSchema).max(500).default([]),
	rows: z
		.array(
			z.object({
				connection: linkedInConnectionSchema,
				action: z.enum(["create", "update"]),
				contactId: z.string().min(1).optional(),
				expectedUpdatedAt: z.coerce.date().optional(),
				duplicateDecision: z.enum(["separate", "merge"]).optional(),
			}),
		)
		.min(1)
		.max(500),
});
export type LinkedInImport = z.infer<typeof linkedInImportSchema>;

type MatchableContact = { id: string; name: string; profileLinks: string[]; sources: { kind: string; id: string }[] };
type MatchableCompany = { id: string; name: string; sources: { kind: string; id: string }[] };

/** Suggestions only: never use this lossy key to silently merge companies. */
export function companyVariantKey(name: string): string {
	return directoryKey(name)
		.replace(/&/g, " and ")
		.replace(/[^\p{L}\p{N}\s]/gu, " ")
		.replace(/\b(?:incorporated|inc|corporation|corp|limited|ltd|llc|plc|gmbh|company|co)\b\s*$/u, "")
		.trim()
		.replace(/\s+/g, " ");
}

export function matchLinkedInCompany(name: string, companies: readonly MatchableCompany[]) {
	const key = directoryKey(name);
	const exact = companies.filter(
		(company) =>
			directoryKey(company.name) === key ||
			company.sources.some((source) => source.kind === "linkedin" && directoryKey(source.id) === key),
	);
	return {
		exact: exact.length === 1 ? (exact[0] ?? null) : null,
		suggestions: companies.filter(
			(company) => !!companyVariantKey(name) && companyVariantKey(company.name) === companyVariantKey(name),
		),
	};
}

type LinkedInContactIndex = { profiles: Map<string, MatchableContact[]>; names: Map<string, MatchableContact[]> };
const profileKeys = (contact: MatchableContact) =>
	new Set(
		[
			...contact.profileLinks,
			...contact.sources.filter((source) => source.kind === "linkedin").map((source) => source.id),
		]
			.map(linkedInProfileKey)
			.filter((key): key is string => key !== null),
	);
export function updateLinkedInContactIndex(
	index: LinkedInContactIndex,
	contact: MatchableContact,
	previous?: MatchableContact,
) {
	const add = (map: Map<string, MatchableContact[]>, key: string) => {
		const list = map.get(key) ?? [];
		if (!list.some((item) => item.id === contact.id)) list.push(contact);
		map.set(key, list);
	};
	if (previous) {
		for (const [map, keys] of [
			[index.names, [directoryKey(previous.name)]],
			[index.profiles, profileKeys(previous)],
		] as const) {
			for (const key of keys) {
				const rest = (map.get(key) ?? []).filter((item) => item.id !== previous.id);
				if (rest.length) map.set(key, rest);
				else map.delete(key);
			}
		}
	}
	add(index.names, directoryKey(contact.name));
	for (const key of profileKeys(contact)) add(index.profiles, key);
}
export function indexLinkedInContacts(contacts: readonly MatchableContact[]): LinkedInContactIndex {
	const index: LinkedInContactIndex = { profiles: new Map(), names: new Map() };
	for (const contact of contacts) updateLinkedInContactIndex(index, contact);
	return index;
}

/** URL matches take precedence over a name; same-name people are always reviewed individually. */
export function matchLinkedInContact(
	connection: LinkedInConnection,
	contacts: readonly MatchableContact[] | ReturnType<typeof indexLinkedInContacts>,
) {
	const index = "profiles" in contacts ? contacts : indexLinkedInContacts(contacts);
	const matches = index.profiles.get(linkedInProfileKey(connection.profileUrl) ?? "") ?? [];
	if (matches.length === 1)
		return { kind: "update" as const, contact: matches[0] ?? null, candidates: matches, identities: matches };
	const candidates = matches.length > 1 ? matches : (index.names.get(directoryKey(connection.name)) ?? []);
	return {
		kind: candidates.length ? ("duplicate" as const) : ("new" as const),
		contact: null,
		candidates,
		identities: matches,
	};
}
