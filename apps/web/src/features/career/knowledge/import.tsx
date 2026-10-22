import type { ImportFactCandidate } from "@reactive-resume/import/facts";
import type { CareerImportFactsResult } from "@reactive-resume/schema/career";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { resumeToFactCandidates } from "@reactive-resume/import/facts";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { isPrivateGroup, nearestGroupSetting, normalizeFactText } from "@reactive-resume/utils/knowledge";
import { detectImportKind, ImportError, readResumeFile } from "@/features/resume/import/read-file";
import { AiProviderLoadState } from "@/features/settings/integrations/ai-provider-load-state";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

const ACCEPT = ".pdf,.docx,.json,.zip,application/pdf,application/json,application/zip";
type Step = "choose" | "reading" | "review" | "saving" | "done";
type Draft = ImportFactCandidate & { selected: boolean };

const rowLabel = (row: Draft) =>
	row.label ||
	(
		{
			summary: t`Summary`,
			education: t`Education`,
			certifications: t`Certifications`,
			skills: t`Skills`,
			languages: t`Languages`,
			awards: t`Awards`,
			projects: t`Projects`,
			publications: t`Publications`,
			volunteer: t`Volunteering`,
			references: t`References`,
			interests: t`Interests`,
		} as Record<string, string>
	)[row.group ?? ""] ||
	t`Other`;

/** Files are read into a review draft, then only selected facts are submitted to Knowledge. */
export function KnowledgeImportPage() {
	const queryClient = useQueryClient();
	const provider = useHasUsableAiProvider();
	const facts = useQuery(orpc.career.facts.queryOptions({ input: { applicationId: null } }));
	const groups = useQuery(orpc.career.factGroups.queryOptions({ input: {} }));
	const [step, setStep] = useState<Step>("choose");
	const [rows, setRows] = useState<Draft[]>([]);
	const [fileName, setFileName] = useState("");
	const [error, setError] = useState("");
	const [note, setNote] = useState("");
	const [result, setResult] = useState<CareerImportFactsResult | null>(null);
	const input = useRef<HTMLInputElement>(null);
	const run = useRef(0);
	const busy = step === "reading" || step === "saving";
	const existing = facts.data ?? [];
	const sources = new Set(existing.filter((fact) => fact.source.kind === "import").map((fact) => fact.source.id));
	const knownText = new Set(existing.map((fact) => normalizeFactText(fact.text)));
	const duplicate = (row: Draft) => sources.has(row.source.id) || knownText.has(normalizeFactText(row.text));
	const chosen = rows.filter((row) => row.selected && !duplicate(row));
	const valid =
		chosen.length > 0 &&
		chosen.length <= 500 &&
		chosen.every((row) => row.text.trim().length > 0 && row.text.length <= 2000);
	const privateGroups = (groups.data ?? [])
		.filter((group) => group.private && group.group)
		.map((group) => group.group as string);
	const settings = new Map(
		(groups.data ?? []).flatMap((group) => (group.group && group.status ? [[group.group, group.status] as const] : [])),
	);

	const reset = () => {
		run.current++;
		setStep("choose");
		setRows([]);
		setResult(null);
		setError("");
		setNote("");
		if (input.current) input.current.value = "";
	};
	const readFile = async (file: File) => {
		const attempt = ++run.current;
		const current = () => attempt === run.current;
		setStep("reading");
		setError("");
		setRows([]);
		setResult(null);
		setFileName(file.name);
		setNote(t`Reading the file…`);
		try {
			if (file.size > 100 * 1024 * 1024)
				throw new ImportError(t`This file is too large. Use a file smaller than 100 MB.`);
			const kind = await detectImportKind(file);
			if (!kind || kind === "cover-letter-json")
				throw new ImportError(t`Choose a resume PDF, Word file, resume JSON or LinkedIn data export ZIP.`);
			if (kind !== "linkedin" && file.size > 10 * 1024 * 1024)
				throw new ImportError(t`Resume files must be smaller than 10 MB.`);
			const digest = Array.from(
				new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())),
				(byte) => byte.toString(16).padStart(2, "0"),
			).join("");
			// Reload Knowledge before reviewing. Failed reads must not look like an empty account.
			const known = await queryClient.fetchQuery({
				...orpc.career.facts.queryOptions({ input: { applicationId: null } }),
				staleTime: 0,
			});
			await queryClient.fetchQuery({ ...orpc.career.factGroups.queryOptions({ input: {} }), staleTime: 0 });
			if (!current()) return;
			if (known.some((fact) => fact.source.kind === "import" && fact.source.id.startsWith(`import:v1:${digest}:`))) {
				setResult({ results: [] });
				setNote(t`This file has already been imported. Your existing facts are unchanged.`);
				setStep("done");
				return;
			}
			let aiAvailable = provider.hasUsableProvider;
			if ((kind === "pdf" || kind === "docx") && provider.isUnavailable) {
				try {
					const providers = await queryClient.fetchQuery({ ...orpc.aiProviders.list.queryOptions(), staleTime: 0 });
					aiAvailable = providers.some((item) => item.enabled && item.testStatus === "success");
				} catch {
					if (kind === "docx")
						throw new ImportError(t`Couldn't load AI connections. Try again before importing this file.`);
					aiAvailable = false;
				}
			}
			const data = await readResumeFile(file, kind, {
				aiAvailable,
				onRead: (message) => {
					if (current()) setNote(message);
				},
			});
			if (!current()) return;
			const seen = new Set(known.map((fact) => normalizeFactText(fact.text)));
			const draft = resumeToFactCandidates(data, digest).map((candidate) => {
				const key = normalizeFactText(candidate.text);
				const selected = candidate.selected && !seen.has(key);
				if (selected) seen.add(key);
				return { ...candidate, selected };
			});
			if (!draft.length)
				throw new ImportError(t`No career facts were found. Try another file or add facts in Knowledge.`);
			setRows(draft);
			setStep("review");
			setNote("");
		} catch (cause) {
			if (!current()) return;
			setError(
				cause instanceof ImportError
					? cause.message
					: getOrpcErrorMessage(cause, { fallback: t`Couldn't read this file. Try again or choose another file.` }),
			);
			setStep("choose");
		}
	};
	const save = async () => {
		if (!valid || busy || facts.isError || groups.isError) return;
		setStep("saving");
		setError("");
		try {
			const saved = await client.career.importFacts({
				facts: chosen.map(({ text, category, group, source }) => ({ text: text.trim(), category, group, source })),
			});
			setResult(saved);
			setStep("done");
			await queryClient.invalidateQueries({ queryKey: orpc.career.key() });
		} catch (cause) {
			setError(
				getOrpcErrorMessage(cause, { fallback: t`Couldn't save these facts. Your review is still here; try again.` }),
			);
			setStep("review");
		}
	};
	const update = (id: string, change: Partial<Pick<Draft, "text" | "selected">>) =>
		setRows((previous) => previous.map((row) => (row.source.id === id ? { ...row, ...change } : row)));
	const grouped = new Map<string, Draft[]>();
	for (const row of rows) {
		const group = row.group ?? "";
		const entries = grouped.get(group);
		if (entries) entries.push(row);
		else grouped.set(group, [row]);
	}

	return (
		<section className="grid min-w-0 gap-5">
			<header className="grid gap-2">
				<h1 className="text-xl font-semibold">
					<Trans>Import into Knowledge</Trans>
				</h1>
				<p className="max-w-2xl text-sm text-ink-2">
					<Trans>Bring in a resume or LinkedIn data export, then choose and edit the facts you want to keep.</Trans>
				</p>
			</header>
			<input
				ref={input}
				type="file"
				className="sr-only"
				aria-label={t`Choose a file to import`}
				accept={ACCEPT}
				disabled={busy}
				onChange={(event) => {
					const file = event.target.files?.[0];
					if (file) void readFile(file);
				}}
			/>
			{error && (
				<div role="alert" className="rounded-lg border border-line p-4 text-sm">
					{error}
				</div>
			)}
			{(step === "choose" || step === "reading") && (
				<>
					<div
						className="grid justify-items-center gap-4 rounded-xl border border-dashed border-line-2 p-8 text-center"
						onDragOver={(event) => event.preventDefault()}
						onDrop={(event) => {
							event.preventDefault();
							const file = event.dataTransfer.files[0];
							if (file && !busy) void readFile(file);
						}}
					>
						<Icon name="upload-simple" size={28} />
						<p className="text-sm">
							<Trans>PDF, Word, resume JSON or LinkedIn export (.zip)</Trans>
						</p>
						{step === "reading" ? (
							<p role="status" className="flex items-center gap-2 text-sm">
								<Spinner decorative className="size-4" />
								{note}
							</p>
						) : (
							<Button
								onClick={() => {
									if (input.current) {
										input.current.value = "";
										input.current.click();
									}
								}}
							>
								<Trans>Choose a file</Trans>
							</Button>
						)}
						{step === "reading" && (
							<Button variant="ghost" onClick={reset}>
								<Trans>Cancel</Trans>
							</Button>
						)}
					</div>
					<div className="grid gap-2 text-sm text-ink-2">
						<p>
							<Trans>
								LinkedIn exports and JSON are read in your browser. We only open LinkedIn's profile files; messages and
								connections are ignored. Selected facts are saved to your account.
							</Trans>
						</p>
						<p>
							<Trans>
								PDFs use your AI connection when available, or the browser reader otherwise. Word files need an AI
								connection.
							</Trans>
						</p>
						<p>
							<Trans>Importing saves facts. To make a resume, use Documents.</Trans>
						</p>
					</div>
					<AiProviderLoadState state={provider} />
				</>
			)}
			{(step === "review" || step === "saving") && (
				<>
					<div className="grid gap-3 rounded-xl bg-sunken p-4">
						<p className="text-sm font-medium break-all">{fileName}</p>
						<p className="text-sm text-ink-2">
							<Trans>
								Review every fact before saving. Hidden resume entries start unchecked. Existing facts are skipped;
								nothing is overwritten.
							</Trans>
						</p>
						<p className="text-sm text-ink-2">
							<Trans>
								New facts follow their group's coaching and privacy settings. New groups start with coaching on.
							</Trans>
						</p>
						<div className="flex flex-wrap items-center gap-3">
							<Button
								size="sm"
								variant="secondary"
								disabled={busy}
								onClick={() => setRows((previous) => previous.map((row) => ({ ...row, selected: false })))}
							>
								<Trans>Clear selection</Trans>
							</Button>
							<span className="text-sm" role="status">{t`${chosen.length} facts selected`}</span>
						</div>
					</div>
					{(facts.isError || groups.isError) && (
						<div role="alert" className="text-sm">
							<Trans>Couldn't refresh Knowledge. Try again before saving.</Trans>
							<Button
								variant="ghost"
								onClick={() => {
									void facts.refetch();
									void groups.refetch();
								}}
							>
								<Trans>Try again</Trans>
							</Button>
						</div>
					)}
					{Array.from(grouped, ([group, entries]) => (
						<fieldset key={group} className="grid min-w-0 gap-3" disabled={busy}>
							<legend className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold">
								{entries[0] ? rowLabel(entries[0]) : group}
								<span className="font-normal text-ink-3">{group}</span>
								{isPrivateGroup(group, privateGroups) ? (
									<span className="text-ink-2">
										<Trans>Private</Trans>
									</span>
								) : nearestGroupSetting(group, settings) === "excluded" ? (
									<span className="text-ink-2">
										<Trans>Coaching off</Trans>
									</span>
								) : null}
							</legend>
							{entries.map((row) => (
								<ImportRow
									key={row.source.id}
									row={row}
									duplicate={duplicate(row)}
									onChange={(change) => update(row.source.id, change)}
								/>
							))}
						</fieldset>
					))}
					{chosen.length > 500 && (
						<p role="alert" className="text-sm">
							<Trans>Select up to 500 facts at a time.</Trans>
						</p>
					)}
					<div className="sticky bottom-3 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-raised p-3 shadow-e1">
						<Button
							disabled={!valid || busy || facts.isError || groups.isError}
							loading={step === "saving"}
							onClick={() => void save()}
						>{t`Save ${chosen.length} facts`}</Button>
						<Button variant="ghost" disabled={busy} onClick={reset}>
							<Trans>Choose another file</Trans>
						</Button>
					</div>
				</>
			)}
			{step === "done" && (
				<div className="grid justify-items-start gap-4 rounded-xl border border-line p-6" role="status">
					<h2 className="font-semibold">
						<Trans>Knowledge import complete</Trans>
					</h2>
					{note ? (
						<p className="text-sm">{note}</p>
					) : (
						<>
							<p>{t`${result?.results.filter((row) => row.status === "saved").length ?? 0} facts saved`}</p>
							<p className="text-sm text-ink-2">{t`${result?.results.filter((row) => row.status !== "saved").length ?? 0} duplicates or previously removed facts skipped`}</p>
						</>
					)}
					<Link to="/dashboard/career/knowledge/facts" className="text-sm underline">
						<Trans>View facts</Trans>
					</Link>
					<Button variant="secondary" onClick={reset}>
						<Trans>Import another file</Trans>
					</Button>
				</div>
			)}
		</section>
	);
}

type ImportRowProps = {
	row: Draft;
	duplicate: boolean;
	onChange: (change: Partial<Pick<Draft, "text" | "selected">>) => void;
};
function ImportRow({ row, duplicate, onChange }: ImportRowProps) {
	return (
		<div className="grid min-w-0 gap-2 rounded-lg border border-line p-3">
			<label className="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					checked={row.selected && !duplicate}
					disabled={duplicate}
					onChange={(event) => onChange({ selected: event.target.checked })}
				/>
				{rowLabel(row)}{" "}
				<span className="text-xs text-ink-3">
					{duplicate
						? t`Already in Knowledge`
						: {
								experience: t`Experience`,
								accomplishment: t`Accomplishment`,
								skill: t`Skill`,
								preference: t`Preference`,
							}[row.category]}
				</span>
			</label>
			<textarea
				aria-label={t`Fact text`}
				value={row.text}
				maxLength={2000}
				rows={Math.min(8, Math.max(2, Math.ceil(row.text.length / 100)))}
				className="bg-field w-full resize-y rounded-md border border-line p-2 text-sm"
				onChange={(event) => onChange({ text: event.target.value })}
			/>
			<details className="text-xs text-ink-3">
				<summary className="cursor-pointer">
					<Trans>Original text</Trans>
				</summary>
				<p className="mt-2 whitespace-pre-wrap">{row.source.quote}</p>
			</details>
		</div>
	);
}
