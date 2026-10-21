import type { AccountArchive, ImportListArea, ImportSetting } from "./archive";
import type { ImportChoices, ImportMode, ImportStep, ImportSummary } from "./run";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useRef, useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@reactive-resume/ui/components/alert-dialog";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { SwitchRow } from "@reactive-resume/ui/components/switch";
import { APP_NAME } from "@reactive-resume/utils/brand";
import { cn } from "@reactive-resume/utils/style";
import { ArchiveError, archiveCounts, archiveSettings, IMPORT_AREAS, readAccountArchive } from "./archive";
import { importSteps, runAccountImport } from "./run";
import { getReadableErrorMessage } from "@/libs/error-message";
import { ENTER_CLASS, POP_CLASS } from "@/libs/motion";
import { orpc } from "@/libs/orpc/client";

type Stage =
	| { name: "choose"; error?: string }
	| { name: "options"; archive: AccountArchive }
	| { name: "running"; steps: ImportStep[]; current: number }
	| { name: "done"; summary: ImportSummary }
	| { name: "failed"; message: string; steps: ImportStep[]; failed: number };

type AreaChoice = { on: boolean; mode: ImportMode };

const STEP_LABELS = (): Record<ImportStep, string> => ({
	documents: t`Documents`,
	applications: t`Applications`,
	knowledge: t`Knowledge`,
	jobSearch: t`Job search`,
	coach: t`Coach conversations`,
	settings: t`Settings`,
});

type ImportAccountDialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

/**
 * Imports an "Export everything" zip from Reactive Resume or All That Work: choose what to bring in, append it or
 * replace a whole area, then see what came in.
 */
export function ImportAccountDialog({ open, onOpenChange }: ImportAccountDialogProps) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const inputRef = useRef<HTMLInputElement>(null);
	const [stage, setStage] = useState<Stage>({ name: "choose" });
	const [areas, setAreas] = useState<Partial<Record<ImportListArea, AreaChoice>>>({});
	const [settings, setSettings] = useState<Partial<Record<ImportSetting, boolean>>>({});
	const [confirming, setConfirming] = useState(false);
	const running = stage.name === "running";

	const readFile = async (file: File) => {
		try {
			const archive = readAccountArchive(new Uint8Array(await file.arrayBuffer()));
			const counts = archiveCounts(archive);
			setAreas(
				Object.fromEntries(
					IMPORT_AREAS.map((area) => [
						area,
						{ on: Object.values(counts[area]).some((count) => count > 0), mode: "append" as const },
					]),
				),
			);
			// Single settings keep the account's own unless chosen here.
			setSettings({});
			setStage({ name: "options", archive });
		} catch (error) {
			setStage({
				name: "choose",
				error: error instanceof ArchiveError ? error.message : t`This file couldn't be read.`,
			});
		}
	};

	const choices = (): ImportChoices => ({
		areas: Object.fromEntries(
			Object.entries(areas).flatMap(([area, choice]) => (choice.on ? [[area, choice.mode]] : [])),
		),
		settings,
	});

	const start = async (archive: AccountArchive) => {
		setConfirming(false);
		const steps = importSteps(choices());
		setStage({ name: "running", steps, current: 0 });
		let current = 0;
		try {
			const summary = await runAccountImport(archive, choices(), (step) => {
				current = steps.indexOf(step);
				setStage({ name: "running", steps, current });
			});
			setStage({ name: "done", summary });
		} catch (error) {
			setStage({
				name: "failed",
				steps,
				failed: current,
				message: getReadableErrorMessage(error, t`The import stopped. Try again.`),
			});
		} finally {
			// Whatever came in shows everywhere, preferences included (they're read from the session).
			await queryClient.invalidateQueries();
			await router.invalidate();
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!running) onOpenChange(next);
			}}
			onOpenChangeComplete={(next) => {
				if (!next) setStage({ name: "choose" });
			}}
		>
			<DialogContent className="sm:max-w-[560px]" showCloseButton={!running} closeLabel={t`Close`}>
				<input
					ref={inputRef}
					type="file"
					accept=".zip,application/zip"
					className="hidden"
					aria-label={t`Choose an account export`}
					onChange={(event) => {
						const file = event.target.files?.[0];
						event.target.value = "";
						if (file) void readFile(file);
					}}
				/>
				<DialogHeader>
					<DialogTitle>
						<Trans>Import an export</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>
							Bring in documents, applications and Knowledge from an Export everything zip, made in Reactive Resume or{" "}
							{APP_NAME}.
						</Trans>
					</DialogDescription>
				</DialogHeader>

				{stage.name === "choose" && (
					<div key="choose" className={cn(ENTER_CLASS, "grid gap-3")}>
						<button
							type="button"
							onClick={() => inputRef.current?.click()}
							onDragOver={(event) => event.preventDefault()}
							onDrop={(event) => {
								event.preventDefault();
								const file = event.dataTransfer.files[0];
								if (file) void readFile(file);
							}}
							className="flex items-start gap-4 rounded-xl border-[1.5px] border-dashed border-line-2 p-5 text-start transition-[background-color,border-color,scale] duration-quick ease-enter hover:border-accent hover:bg-accent-soft active:scale-[0.98]"
						>
							<span className="grid size-11 shrink-0 place-items-center rounded-[10px] bg-sunken text-ink-2">
								<Icon name="file-arrow-up" size={24} />
							</span>
							<span className="grid gap-1">
								<span className="text-[15px] font-semibold">
									<Trans>Choose the zip</Trans>
								</span>
								<span className="text-[13px] leading-[19px] text-ink-2">
									<Trans>
										Drop it here or browse. It's read in your browser first, so you can pick what to import before
										anything is saved.
									</Trans>
								</span>
							</span>
						</button>
						{stage.error && (
							<p role="alert" className="text-[13px] text-danger-text">
								{stage.error}
							</p>
						)}
					</div>
				)}

				{stage.name === "options" && (
					<ImportOptions
						archive={stage.archive}
						areas={areas}
						settings={settings}
						onAreasChange={setAreas}
						onSettingsChange={setSettings}
						onBack={() => setStage({ name: "choose" })}
						onImport={() => {
							if (Object.values(areas).some((choice) => choice.on && choice.mode === "replace")) setConfirming(true);
							else void start(stage.archive);
						}}
					/>
				)}

				{(stage.name === "running" || stage.name === "failed") && (
					<div key="progress" className={cn(ENTER_CLASS, "grid gap-3")}>
						<ol className="grid gap-2.5" aria-label={t`Import steps`}>
							{stage.steps.map((step, index) => {
								const position = stage.name === "running" ? stage.current : stage.failed;
								const done = index < position;
								const current = index === position;
								return (
									<li
										key={step}
										className={cn("flex items-center gap-2.5 text-sm", done || current ? "text-ink" : "text-ink-3")}
									>
										{done ? (
											<Icon name="check-circle" size={18} className={cn(POP_CLASS, "text-accent-text")} />
										) : current && stage.name === "failed" ? (
											<Icon name="warning-circle" size={18} className="text-danger-text" />
										) : current ? (
											<Spinner decorative className={cn(POP_CLASS, "size-[18px]")} />
										) : (
											<span className="size-[18px] rounded-full border-[1.5px] border-line-2" />
										)}
										<span className="font-medium">{STEP_LABELS()[step]}</span>
									</li>
								);
							})}
						</ol>
						{stage.name === "failed" && (
							<>
								<p role="alert" className="text-[13px] text-danger-text">
									{stage.message}
								</p>
								<p className="text-[13px] text-ink-2">
									<Trans>The steps marked done were imported. Nothing from the failed step was saved.</Trans>
								</p>
								<DialogFooter showCloseButton closeLabel={t`Close`} />
							</>
						)}
					</div>
				)}

				{stage.name === "done" && <ImportReport summary={stage.summary} />}
			</DialogContent>

			{stage.name === "options" && (
				<ReplaceConfirmation
					open={confirming}
					onOpenChange={setConfirming}
					areas={areas}
					onConfirm={() => void start(stage.archive)}
				/>
			)}
		</Dialog>
	);
}

type ImportOptionsProps = {
	archive: AccountArchive;
	areas: Partial<Record<ImportListArea, AreaChoice>>;
	settings: Partial<Record<ImportSetting, boolean>>;
	onAreasChange: (areas: Partial<Record<ImportListArea, AreaChoice>>) => void;
	onSettingsChange: (settings: Partial<Record<ImportSetting, boolean>>) => void;
	onBack: () => void;
	onImport: () => void;
};

function ImportOptions({
	archive,
	areas,
	settings,
	onAreasChange,
	onSettingsChange,
	onBack,
	onImport,
}: ImportOptionsProps) {
	const counts = archiveCounts(archive);
	const available = archiveSettings(archive);
	const labels = STEP_LABELS();
	const exported = archive.exportedAt
		? new Date(archive.exportedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
		: null;
	const from = archive.source === "allthatwork" ? APP_NAME : "Reactive Resume";

	const details: Record<ImportListArea, string> = {
		documents: [
			plural(counts.documents.resumes, { one: "# resume", other: "# resumes" }),
			plural(counts.documents.letters, { one: "# letter", other: "# letters" }),
		].join(", "),
		applications: plural(counts.applications.applications, { one: "# application", other: "# applications" }),
		knowledge: [
			plural(counts.knowledge.facts, { one: "# fact", other: "# facts" }),
			plural(counts.knowledge.stories, { one: "# story", other: "# stories" }),
			...(archive.source === "allthatwork"
				? [plural(counts.knowledge.groups, { one: "# group", other: "# groups" })]
				: []),
		].join(", "),
		jobSearch: [
			plural(counts.jobSearch.opportunities, { one: "# posting found", other: "# postings found" }),
			plural(counts.jobSearch.schedules, { one: "# schedule", other: "# schedules" }),
		].join(", "),
		coach: plural(counts.coach.threads, { one: "# conversation", other: "# conversations" }),
	};

	const settingLabels: Record<ImportSetting, { label: string; description: string }> = {
		preferences: {
			label: t`Preferences`,
			description: t`Resume length and reminders. Off keeps yours.`,
		},
		aiLimits: {
			label: t`AI limits`,
			description: t`How much Knowledge the AI reads, and time limits. Off keeps yours.`,
		},
		profile: {
			label: t`Career preferences`,
			description: t`Target roles, locations, pay and what matters to you. Off keeps yours.`,
		},
	};

	const nothingChosen = !Object.values(areas).some((choice) => choice.on) && !Object.values(settings).some(Boolean);

	return (
		<div key="options" className={cn(ENTER_CLASS, "grid gap-4")}>
			<p className="text-[13px] text-ink-2">
				{exported ? (
					<Trans>
						From {from}, exported {exported}.
					</Trans>
				) : (
					<Trans>From {from}.</Trans>
				)}
			</p>

			<div className="grid divide-y divide-line">
				{IMPORT_AREAS.map((area) => {
					const choice = areas[area] ?? { on: false, mode: "append" };
					const empty = !Object.values(counts[area]).some((count) => count > 0);
					return (
						<div key={area} className="grid gap-2 py-2">
							<SwitchRow
								label={labels[area]}
								description={details[area]}
								checked={choice.on}
								disabled={empty}
								onCheckedChange={(on) => onAreasChange({ ...areas, [area]: { ...choice, on } })}
							/>
							{choice.on && (
								<SegmentedControl
									aria-label={t`How ${labels[area]} come in`}
									value={choice.mode}
									className="h-9 w-fit max-w-full"
									onValueChange={(mode) => onAreasChange({ ...areas, [area]: { ...choice, mode: mode as ImportMode } })}
								>
									<SegmentedControlItem value="append" className="touch-target relative flex-auto max-sm:px-2">
										<Trans>Add to mine</Trans>
									</SegmentedControlItem>
									<SegmentedControlItem value="replace" className="touch-target relative flex-auto max-sm:px-2">
										<Trans>Replace mine</Trans>
									</SegmentedControlItem>
								</SegmentedControl>
							)}
						</div>
					);
				})}
				{(Object.keys(available) as ImportSetting[])
					.filter((key) => available[key])
					.map((key) => (
						<div key={key} className="py-2">
							<SwitchRow
								label={settingLabels[key].label}
								description={settingLabels[key].description}
								checked={settings[key] ?? false}
								onCheckedChange={(on) => onSettingsChange({ ...settings, [key]: on })}
							/>
						</div>
					))}
			</div>

			<p className="text-[13px] text-ink-2">
				<Trans>
					Added records come in as new ones, so tidy up afterwards in Knowledge, Curate. Public resumes come in private,
					and schedules come in switched off.
				</Trans>
			</p>

			<DialogFooter>
				<Button variant="secondary" onClick={onBack}>
					<Trans>Back</Trans>
				</Button>
				<Button disabled={nothingChosen} onClick={onImport}>
					<Trans>Import</Trans>
				</Button>
			</DialogFooter>
		</div>
	);
}

type ReplaceConfirmationProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	areas: Partial<Record<ImportListArea, AreaChoice>>;
	onConfirm: () => void;
};

/** Names what replacing deletes, including what goes with applications in other areas. */
function ReplaceConfirmation({ open, onOpenChange, areas, onConfirm }: ReplaceConfirmationProps) {
	const { data: current } = useQuery({ ...orpc.auth.importPreview.queryOptions(), enabled: open });
	const replacing = IMPORT_AREAS.filter((area) => areas[area]?.on && areas[area].mode === "replace");
	const labels = STEP_LABELS();

	const lines: Record<ImportListArea, string> = current
		? {
				documents: [
					plural(current.documents.resumes, { one: "# resume", other: "# resumes" }),
					plural(current.documents.letters, { one: "# letter", other: "# letters" }),
					...(current.documents.locked > 0
						? [
								plural(current.documents.locked, {
									one: "# locked resume among them",
									other: "# locked resumes among them",
								}),
							]
						: []),
				].join(", "),
				applications: [
					plural(current.applications.applications, { one: "# application", other: "# applications" }),
					...(current.applications.linked > 0
						? [
								plural(current.applications.linked, {
									one: "# fact, story, saved item, schedule or conversation tied to one",
									other: "# facts, stories, saved items, schedules and conversations tied to them",
								}),
							]
						: []),
				].join(", "),
				knowledge: [
					plural(current.knowledge.facts, { one: "# fact", other: "# facts" }),
					plural(current.knowledge.stories, { one: "# story", other: "# stories" }),
					plural(current.knowledge.groups, { one: "# group", other: "# groups" }),
				].join(", "),
				jobSearch: [
					plural(current.jobSearch.opportunities, { one: "# posting found", other: "# postings found" }),
					plural(current.jobSearch.schedules, { one: "# schedule", other: "# schedules" }),
				].join(", "),
				coach: plural(current.coach.threads, { one: "# conversation", other: "# conversations" }),
			}
		: { documents: "", applications: "", knowledge: "", jobSearch: "", coach: "" };

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						<Trans>Replace what you have?</Trans>
					</AlertDialogTitle>
					<AlertDialogDescription>
						<Trans>These are deleted before the import, and can't be brought back:</Trans>
					</AlertDialogDescription>
				</AlertDialogHeader>
				{current ? (
					<ul className="grid gap-1.5 text-sm">
						{replacing.map((area) => (
							<li key={area}>
								<span className="font-medium">{labels[area]}:</span> {lines[area]}
							</li>
						))}
					</ul>
				) : (
					<Spinner decorative className="size-5" />
				)}
				{areas.documents?.on && areas.documents.mode === "replace" && !areas.applications?.on && (
					<p className="text-[13px] text-ink-2">
						<Trans>Your applications stay, but lose their linked resumes and letters.</Trans>
					</p>
				)}
				<AlertDialogFooter>
					<AlertDialogCancel>
						<Trans>Cancel</Trans>
					</AlertDialogCancel>
					<AlertDialogAction variant="danger" disabled={!current} onClick={onConfirm}>
						<Trans>Replace and import</Trans>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

const KIND_LABELS = (): Record<string, string> => ({
	resumes: t`Resumes`,
	letters: t`Letters`,
	applications: t`Applications`,
	workspaces: t`Application workspaces`,
	letterLinks: t`Letter links`,
	facts: t`Facts`,
	groups: t`Fact groups`,
	overrides: t`Knowledge choices for applications`,
	stories: t`Stories`,
	artifacts: t`Saved items`,
	opportunities: t`Postings found`,
	schedules: t`Schedules`,
	threads: t`Conversations`,
	messages: t`Messages`,
	transcripts: t`Transcripts`,
	preferences: t`Preferences`,
	aiLimits: t`AI limits`,
	profile: t`Career preferences`,
});

type ImportReportProps = { summary: ImportSummary };

function ImportReport({ summary }: ImportReportProps) {
	const labels = KIND_LABELS();
	const reasons = {
		unreadable: t`couldn't be read`,
		unlinked: t`belonged to something that wasn't imported`,
		exists: t`were already in your account`,
		files: t`only their names are in the export`,
	};
	const added = Object.entries(summary.added).filter(([kind]) => kind !== "messages");

	return (
		<div key="done" className={cn(ENTER_CLASS, "grid gap-4")}>
			<p className="flex items-center gap-2 text-sm font-medium">
				<Icon name="check-circle" size={18} className={cn(POP_CLASS, "text-accent-text")} />
				<Trans>Import finished</Trans>
			</p>
			{added.length > 0 && (
				<dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
					{added.map(([kind, count]) => (
						<div key={kind} className="contents">
							<dt className="text-ink-2">{labels[kind] ?? kind}</dt>
							<dd className="text-end tabular-nums">{count}</dd>
						</div>
					))}
				</dl>
			)}
			<ul className="grid gap-1.5 text-[13px] text-ink-2">
				{summary.skipped.map((skip) => (
					<li key={`${skip.kind}-${skip.reason}`}>
						{labels[skip.kind] ?? skip.kind}: {skip.count} {reasons[skip.reason]}
					</li>
				))}
				{summary.attachments > 0 && (
					<li>
						{plural(summary.attachments, {
							one: "# conversation attachment wasn't imported: only its name is in the export.",
							other: "# conversation attachments weren't imported: only their names are in the export.",
						})}
					</li>
				)}
				{summary.madePrivate > 0 && (
					<li>
						{plural(summary.madePrivate, {
							one: "# resume was public and came in private. Share it again from the resume.",
							other: "# resumes were public and came in private. Share them again from each resume.",
						})}
					</li>
				)}
				{(summary.added.schedules ?? 0) > 0 && <li>{t`Schedules came in switched off. Turn on the ones you want.`}</li>}
				{(summary.added.threads ?? 0) > 0 && <li>{t`Conversations continue with your own AI provider.`}</li>}
			</ul>
			<DialogFooter showCloseButton closeLabel={t`Done`} />
		</div>
	);
}
