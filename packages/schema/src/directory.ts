import z from "zod";

export const directorySourceSchema = z.object({
	kind: z.enum(["manual", "application", "interview", "linkedin", "import"]),
	id: z.string().trim().min(1).max(2048),
});
export type DirectorySource = z.infer<typeof directorySourceSchema>;

// Conservative matching: punctuation and legal suffixes remain significant. Variants require review.
export const directoryKey = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
const text = (max: number) => z.string().trim().max(max);
const webUrl = z.url({ protocol: /^https?$/ }).max(2048);
export const companyFieldsSchema = z.object({
	name: text(300).min(1),
	website: webUrl.nullable().default(null),
	notes: text(20_000).default(""),
	sources: z.array(directorySourceSchema).max(500).default([]),
});
export const contactFieldsSchema = z.object({
	companyId: z.string().min(1).nullable().default(null),
	name: text(200).min(1),
	position: text(300).default(""),
	profileLinks: z.array(webUrl).max(20).default([]),
	emails: z.array(z.email().max(320)).max(20).default([]),
	phones: z.array(text(100).min(1)).max(20).default([]),
	notes: text(20_000).default(""),
	tags: z.array(text(100).min(1)).max(100).default([]),
	relationship: text(2000).default(""),
	lookingForWork: z.boolean().default(false),
	connectedOn: z.iso.date().nullable().default(null),
	sources: z.array(directorySourceSchema).max(500).default([]),
	lastImportedAt: z.coerce.date().nullable().default(null),
	lastContactedAt: z.coerce.date().nullable().default(null),
});
