import type { CareerImportFact, FactCategory } from "@reactive-resume/schema/career";
import type { ResumeData } from "@reactive-resume/schema/resume/data";

export type ImportFactCandidate = CareerImportFact & {
	label: string;
	selected: boolean;
};

const entities: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	ndash: "–",
	mdash: "—",
	lsquo: "‘",
	rsquo: "’",
	ldquo: "“",
	rdquo: "”",
	bull: "•",
	hellip: "…",
};

function decodeText(text: string) {
	return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity: string, name: string) => {
		if (!name.startsWith("#")) return entities[name] ?? entity;
		const hex = name[1]?.toLowerCase() === "x";
		const code = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
		return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : entity;
	});
}

/** Read rich text without a DOM. List items stay separate; ordinary paragraphs form one description. */
function textBlocks(html: string): string[] {
	const boundary = /<li\b/i.test(html) ? "\u0001" : "\n";
	const text = decodeText(
		html
			.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
			.replace(/<!--[^]*?-->/g, "")
			.replace(/<\/?(?:li|p|div|h[1-6]|tr|blockquote)\b[^>]*>|<br\b[^>]*\/?\s*>/gi, boundary)
			.replace(/<[^>]*>/g, ""),
	);
	return text
		.split("\u0001")
		.map((block) => block.replace(/\s+/g, " ").trim())
		.filter(Boolean);
}

const plain = (value: unknown) => (typeof value === "string" ? decodeText(value).replace(/\s+/g, " ").trim() : "");
const join = (values: unknown[], separator = ", ") => values.map(plain).filter(Boolean).join(separator);

/** Split at sentences or words, retaining every non-whitespace character and respecting the fact cap. */
function chunks(text: string, max: number): string[] {
	const result: string[] = [];
	let remaining = text.trim();
	while (remaining.length > max) {
		const head = remaining.slice(0, max + 1);
		const sentence = [...head.matchAll(/[.!?](?:\s|$)/g)].at(-1)?.index;
		let cut = sentence !== undefined && sentence > max / 2 ? sentence + 1 : head.lastIndexOf(" ");
		if (cut < max / 2) cut = max;
		// Never split a UTF-16 surrogate pair.
		if (/[\uD800-\uDBFF]/.test(remaining[cut - 1] ?? "")) cut--;
		result.push(remaining.slice(0, cut).trim());
		remaining = remaining.slice(cut).trim();
	}
	if (remaining) result.push(remaining);
	return result;
}

const groupSlug = (text: string) =>
	text
		.normalize("NFKD")
		.toLowerCase()
		.replace(/\p{M}/gu, "")
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 80)
		.replace(/[\uD800-\uDBFF]$/, "") || "unnamed";

type Entry = Record<string, unknown>;
type Section = { title: string; hidden: boolean; items: readonly unknown[] };

/** Every file reader returns ResumeData; this conversion never creates or stores a resume document. */
export function resumeToFactCandidates(data: ResumeData, fileDigest: string): ImportFactCandidate[] {
	if (!/^[a-f0-9]{64}$/.test(fileDigest)) throw new Error("A SHA-256 file digest is required.");
	const facts: ImportFactCandidate[] = [];
	const add = (
		key: string,
		text: string,
		category: FactCategory,
		group: string,
		label: string,
		selected: boolean,
		context = "",
	) => {
		const prefix = context ? `${context.length > 400 ? `${chunks(context, 399)[0]}…` : context}: ` : "";
		chunks(text, 2000 - prefix.length).forEach((quote, index) => {
			facts.push({
				text: prefix + quote,
				category,
				group,
				label,
				selected,
				source: { kind: "import", id: `import:v1:${fileDigest}:${key}/${index}`, quote },
			});
		});
	};
	const descriptions = (
		entry: Entry,
		key: string,
		context: string,
		group: string,
		label: string,
		selected: boolean,
	) => {
		textBlocks(typeof entry.description === "string" ? entry.description : "").forEach((block, index) =>
			add(`${key}/description/${index}`, block, "accomplishment", group, label, selected, context),
		);
	};

	add("headline", plain(data.basics.headline), "experience", "summary", data.summary.title, true);
	add(
		"summary",
		textBlocks(data.summary.content).join(" "),
		"experience",
		"summary",
		data.summary.title,
		!data.summary.hidden,
	);

	const readSection = (type: string, section: Section, path: string, custom = false) => {
		if (type === "profiles" || type === "cover-letter") return;
		const baseGroup = custom ? `custom/${groupSlug(section.title)}` : type;
		const entries = section.items as Entry[];
		if (type === "skills" || type === "interests") {
			for (const hidden of [false, true]) {
				const text = entries
					.filter((entry) => Boolean(entry.hidden) === hidden)
					.map((entry) => join([entry.name, ...(Array.isArray(entry.keywords) ? entry.keywords : [])], ": "))
					.filter(Boolean)
					.join("; ");
				add(
					`${path}/${hidden ? "hidden" : "visible"}`,
					text,
					"skill",
					baseGroup,
					section.title,
					!section.hidden && !hidden,
				);
			}
			return;
		}
		entries.forEach((entry, index) => {
			const key = `${path}/${index}`;
			const selected = !section.hidden && !entry.hidden;
			if (type === "summary") {
				add(
					key,
					textBlocks(typeof entry.content === "string" ? entry.content : "").join(" "),
					"experience",
					baseGroup,
					section.title,
					selected,
				);
				return;
			}
			if (type === "experience") {
				const company = plain(entry.company);
				const group = `${baseGroup}/${groupSlug(company)}`;
				const context = join([entry.position, company], " at ");
				const header = join([context, entry.period, entry.location]);
				add(`${key}/header`, header, "experience", group, company || section.title, selected);
				descriptions(entry, key, context, group, company || section.title, selected);
				if (Array.isArray(entry.roles))
					entry.roles.forEach((role: Entry, roleIndex: number) => {
						const roleContext = join([role.position, company], " at ");
						const roleKey = `${key}/roles/${roleIndex}`;
						add(
							`${roleKey}/header`,
							join([roleContext, role.period, entry.location]),
							"experience",
							group,
							company || section.title,
							selected,
						);
						descriptions(role, roleKey, roleContext, group, company || section.title, selected);
					});
				return;
			}
			const fields: Record<string, string[]> = {
				education: ["degree", "area", "school", "period", "grade", "location"],
				certifications: ["title", "issuer", "date"],
				awards: ["title", "awarder", "date"],
				projects: ["name", "period"],
				publications: ["title", "publisher", "date"],
				volunteer: ["organization", "period", "location"],
				languages: ["language", "fluency"],
				references: ["name", "position"],
			};
			const header = join((fields[type] ?? ["name", "title", "period"]).map((field) => entry[field]));
			// Keep section details (certification expiry, activities, etc.) with their header, without inventing a claim.
			const description = textBlocks(typeof entry.description === "string" ? entry.description : "").join(" ");
			const combined = join([header, description], ": ");
			if (combined.length <= 2000) add(key, combined, "experience", baseGroup, section.title, selected);
			else {
				add(`${key}/header`, header, "experience", baseGroup, section.title, selected);
				add(`${key}/description`, description, "experience", baseGroup, section.title, selected, header);
			}
		});
	};
	for (const [type, section] of Object.entries(data.sections)) readSection(type, section, type);
	data.customSections.forEach((section, index) => readSection(section.type, section, `custom/${index}`, true));
	return facts;
}
