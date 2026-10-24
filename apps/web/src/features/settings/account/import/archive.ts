import { t } from "@lingui/core/macro";
import { strFromU8, unzipSync } from "fflate";
import { APP_NAME } from "@reactive-resume/utils/brand";

type Rows = Record<string, unknown>[];

/** An "Export everything" zip, read in the browser. Records stay as exported; the server reads them one by one. */
export type AccountArchive = {
	/** All That Work exports carry fact groups, overrides and the Knowledge review; upstream's don't. */
	source: "allthatwork" | "reactive-resume";
	exportedAt: string | null;
	user: Record<string, unknown>;
	resumes: Rows;
	letters: Rows;
	applications: Rows;
	directory?: { companies: Rows; contacts: Rows; employment: Rows; notes: Rows };
	career: {
		profile: Record<string, unknown> | null;
		aiLimits: Record<string, unknown> | null;
		facts: Rows;
		factGroups: Rows;
		factOverrides: Rows;
		stories: Rows;
		artifacts: Rows;
		workspaces: Rows;
		opportunities: Rows;
		schedules: Rows;
		threads: Rows;
		messages: Rows;
		transcripts: Rows;
		attachments: Rows;
	};
};

// Coach conversations make career.json the biggest file; real exports are a few megabytes.
const MAX_ENTRY_BYTES = 200 * 1024 * 1024;
const MAX_TOTAL_BYTES = 500 * 1024 * 1024;
const MAX_ENTRIES = 20_000;

const wanted = (name: string) =>
	name === "account.json" ||
	name === "applications.json" ||
	name === "career.json" ||
	name === "directory.json" ||
	/^(resumes|letters)\/[^/]+\.json$/.test(name);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const rows = (value: unknown): Rows => (Array.isArray(value) ? value.filter(isRecord) : []);

export class ArchiveError extends Error {}

export function readAccountArchive(bytes: Uint8Array): AccountArchive {
	let files: Record<string, Uint8Array>;
	let total = 0;
	let entries = 0;
	let tooLarge = false;
	try {
		files = unzipSync(bytes, {
			filter: (file) => {
				entries++;
				if (!wanted(file.name)) return false;
				total += file.originalSize;
				if (file.originalSize > MAX_ENTRY_BYTES || total > MAX_TOTAL_BYTES || entries > MAX_ENTRIES) tooLarge = true;
				return !tooLarge;
			},
		});
	} catch {
		throw new ArchiveError(t`This file couldn't be read as a zip. Choose the zip that Export everything downloaded.`);
	}
	if (tooLarge) throw new ArchiveError(t`This zip is too large to be an account export.`);

	const json = (name: string): unknown => {
		const file = files[name];
		if (!file) return undefined;
		try {
			return JSON.parse(strFromU8(file));
		} catch {
			throw new ArchiveError(t`${name} in this zip isn't valid JSON.`);
		}
	};

	const account = json("account.json");
	const career = json("career.json");
	const directory = json("directory.json");
	if (!isRecord(account) || !isRecord(career)) {
		throw new ArchiveError(
			t`This zip isn't an account export. Use the zip from Settings, Your data, Export everything, in Reactive Resume or ${APP_NAME}.`,
		);
	}

	const documents = (folder: string) =>
		Object.keys(files)
			.filter((name) => name.startsWith(`${folder}/`))
			.toSorted()
			.map((name) => json(name))
			.filter(isRecord);

	return {
		source:
			"factGroups" in career || "factOverrides" in career || "review" in career ? "allthatwork" : "reactive-resume",
		exportedAt: typeof account.exportedAt === "string" ? account.exportedAt : null,
		user: isRecord(account.user) ? account.user : {},
		resumes: documents("resumes"),
		letters: documents("letters"),
		applications: rows(json("applications.json")),
		directory: {
			companies: rows(isRecord(directory) ? directory.companies : []),
			contacts: rows(isRecord(directory) ? directory.contacts : []),
			employment: rows(isRecord(directory) ? directory.employment : []),
			notes: rows(isRecord(directory) ? directory.notes : []),
		},
		career: {
			profile: isRecord(career.profile) ? career.profile : null,
			aiLimits: isRecord(career.aiLimits) ? career.aiLimits : null,
			facts: rows(career.facts),
			factGroups: rows(career.factGroups),
			factOverrides: rows(career.factOverrides),
			stories: rows(career.stories),
			artifacts: rows(career.artifacts),
			workspaces: rows(career.workspaces),
			opportunities: rows(career.opportunities),
			schedules: rows(career.schedules),
			threads: rows(career.threads),
			messages: rows(career.messages),
			transcripts: rows(career.transcripts),
			attachments: rows(career.attachments),
		},
	};
}

export const IMPORT_AREAS = ["documents", "directory", "applications", "knowledge", "jobSearch", "coach"] as const;
export type ImportListArea = (typeof IMPORT_AREAS)[number];

const live = (list: Rows) => list.filter((row) => !row.deletedAt && row.status !== "deleted");

/** What each area of the archive holds, as shown before importing. */
export function archiveCounts(archive: AccountArchive) {
	const { career } = archive;
	return {
		directory: {
			companies: archive.directory?.companies.length ?? 0,
			contacts: archive.directory?.contacts.length ?? 0,
		},
		documents: { resumes: archive.resumes.length, letters: archive.letters.length },
		applications: { applications: archive.applications.length },
		knowledge: {
			facts: career.facts.filter((fact) => fact.status !== "forgotten").length,
			stories: career.stories.length,
			groups: career.factGroups.length,
		},
		jobSearch: { opportunities: career.opportunities.length, schedules: career.schedules.length },
		coach: { threads: live(career.threads).length },
	} satisfies Record<ImportListArea, Record<string, number>>;
}

const PREFERENCE_KEYS = ["resumePages", "noReplyDays", "interviewReminders"];

/** The single settings the archive has; each is either kept as the account has it or taken from the file. */
export function archiveSettings(archive: AccountArchive) {
	return {
		preferences: PREFERENCE_KEYS.some((key) => key in archive.user),
		aiLimits: archive.career.aiLimits !== null,
		profile: archive.career.profile !== null,
	};
}

export type ImportSetting = keyof ReturnType<typeof archiveSettings>;
