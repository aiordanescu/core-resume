import type { AccountArchive, ImportListArea, ImportSetting } from "./archive";
import type { RouterOutput } from "@/libs/orpc/client";
import { client } from "@/libs/orpc/client";

type ImportInput = Parameters<typeof client.auth.importData>[0];
type ImportResult = RouterOutput["auth"]["importData"];
type Ids = NonNullable<Extract<ImportInput, { area: "applications" }>["ids"]>;

export type ImportMode = "append" | "replace";

export type ImportChoices = {
	/** Areas to import, each appended or replacing what the account has. Left out: not imported. */
	areas: Partial<Record<ImportListArea, ImportMode>>;
	/** Settings to take from the file; the rest keep the account's own. */
	settings: Partial<Record<ImportSetting, boolean>>;
};

export type ImportStep = ImportListArea | "settings";

export type ImportSummary = {
	added: Record<string, number>;
	skipped: ImportResult["skipped"];
	madePrivate: number;
	/** Conversation attachments: only their names are in the export. */
	attachments: number;
};

const mergeIds = (into: Ids, from: Ids) => {
	for (const [kind, map] of Object.entries(from) as Array<[keyof Ids, Record<string, string> | undefined]>) {
		if (map) into[kind] = { ...into[kind], ...map };
	}
};

const id = (value: unknown) => (typeof value === "string" ? value : null);

/** The request for one area, built from the archive and the new ids earlier areas returned. */
function request(archive: AccountArchive, area: ImportStep, mode: ImportMode, ids: Ids): ImportInput {
	const { career } = archive;
	switch (area) {
		case "documents":
			return { area, mode, resumes: archive.resumes, letters: archive.letters };
		case "directory":
			return {
				area,
				mode,
				companies: archive.directory?.companies ?? [],
				contacts: archive.directory?.contacts ?? [],
				employment: archive.directory?.employment ?? [],
				notes: archive.directory?.notes ?? [],
			};
		case "applications":
			return {
				area,
				mode,
				ids,
				applications: archive.applications,
				workspaces: career.workspaces,
				letterLinks: archive.letters.flatMap((letter) => {
					const letterId = id(letter.id);
					const applicationId = id(letter.sourceApplicationId);
					return letterId && applicationId ? [{ letterId, applicationId }] : [];
				}),
			};
		case "knowledge":
			return {
				area,
				mode,
				ids,
				facts: career.facts,
				groups: career.factGroups,
				overrides: career.factOverrides,
				stories: career.stories,
				artifacts: career.artifacts,
			};
		case "jobSearch":
			return { area, mode, ids, opportunities: career.opportunities, schedules: career.schedules };
		case "coach":
			return { area, mode, ids, threads: career.threads, messages: career.messages, transcripts: career.transcripts };
		case "settings":
			return { area };
	}
}

/** The areas that will run, in the order their records depend on each other. */
export function importSteps(choices: ImportChoices): ImportStep[] {
	const order: ImportListArea[] = ["documents", "directory", "applications", "knowledge", "jobSearch", "coach"];
	const steps: ImportStep[] = order.filter((area) => choices.areas[area]);
	if (Object.values(choices.settings).some(Boolean)) steps.push("settings");
	return steps;
}

/**
 * Imports the chosen areas one request at a time, each in its own transaction on the server. An area that fails stops
 * the import; the areas before it stay imported.
 */
export async function runAccountImport(
	archive: AccountArchive,
	choices: ImportChoices,
	onStep: (step: ImportStep) => void,
): Promise<ImportSummary> {
	const ids: Ids = {};
	const summary: ImportSummary = { added: {}, skipped: [], madePrivate: 0, attachments: 0 };

	for (const step of importSteps(choices)) {
		onStep(step);
		const input =
			step === "settings"
				? {
						area: step,
						preferences: choices.settings.preferences ? archive.user : null,
						aiLimits: choices.settings.aiLimits ? archive.career.aiLimits : null,
						profile: choices.settings.profile ? archive.career.profile : null,
					}
				: request(archive, step, choices.areas[step] ?? "append", ids);
		const result = await client.auth.importData(input);
		mergeIds(ids, result.ids);
		for (const [kind, count] of Object.entries(result.added)) summary.added[kind] = (summary.added[kind] ?? 0) + count;
		summary.skipped.push(...result.skipped);
		summary.madePrivate += result.madePrivate;
		if (step === "coach") summary.attachments = archive.career.attachments.length;
	}
	return summary;
}
