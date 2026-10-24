import type { Fact } from "../hooks";
import type { ImportCorrection } from "./import-comparison";
import type { ContactsImportSelection, ContactsImportResult } from "./import-contacts";
import type { ImportDuplicates } from "./import-duplicates";
import type { ImportFactCandidate } from "@reactive-resume/import/facts";
import type { LinkedInConnectionsFile } from "@reactive-resume/import/linkedin-connections";
import type { CareerImportFactsResult } from "@reactive-resume/schema/career";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { resumeToFactCandidates } from "@reactive-resume/import/facts";
import { readLinkedInConnections } from "@reactive-resume/import/linkedin-connections";
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
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { isPrivateGroup, nearestGroupSetting, normalizeFactText } from "@reactive-resume/utils/knowledge";
import { ImportComparison } from "./import-comparison";
import { ContactsImportReview, emptyContactsResult, saveReviewedContacts } from "./import-contacts";
import { findImportDuplicates } from "./import-duplicates";
import { ImportRow, rowLabel } from "./import-fact-row";
import { detectImportKind, ImportError, readResumeFile } from "@/features/resume/import/read-file";
import { AiProviderLoadState } from "@/features/settings/integrations/ai-provider-load-state";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

const ACCEPT = ".pdf,.docx,.json,.zip,application/pdf,application/json,application/zip";
type Step = "choose" | "options" | "reading" | "review" | "saving" | "done";
type Draft = ImportFactCandidate & { selected: boolean };

/** One local file supplies reviewed career facts and, optionally, Directory contacts. */
export function KnowledgeImportPage() {
	const queryClient = useQueryClient();
	const provider = useHasUsableAiProvider();
	const facts = useQuery(orpc.career.facts.queryOptions({ input: { applicationId: null } }));
	const groups = useQuery(orpc.career.factGroups.queryOptions({ input: {} }));
	const [step, setStep] = useState<Step>("choose");
	const [rows, setRows] = useState<Draft[]>([]);
	const [matches, setMatches] = useState<ImportDuplicates>(new Map());
	const [corrections, setCorrections] = useState<Map<string, ImportCorrection>>(new Map());
	const [corrected, setCorrected] = useState<Set<string>>(new Set());
	const [checking, setChecking] = useState(false);
	const [fileName, setFileName] = useState("");
	const [error, setError] = useState("");
	const [note, setNote] = useState("");
	const [result, setResult] = useState<CareerImportFactsResult | null>(null);
	const [connections, setConnections] = useState<LinkedInConnectionsFile | null>(null);
	const [connectionsWarning, setConnectionsWarning] = useState("");
	const [careerWarning, setCareerWarning] = useState("");
	const [pending, setPending] = useState<{ file: File; bytes: Uint8Array<ArrayBuffer> } | null>(null);
	const [importFacts, setImportFacts] = useState(true);
	const [importContacts, setImportContacts] = useState(false);
	const [contactsSelection, setContactsSelection] = useState<ContactsImportSelection | null>(null);
	const [contactsResult, setContactsResult] = useState<ContactsImportResult>(emptyContactsResult);
	const savedProfiles = useRef(new Set<string>());
	const input = useRef<HTMLInputElement>(null);
	const run = useRef(0);
	const busy =
		checking || step === "reading" || step === "saving" || [...corrections.values()].some((edit) => edit.saving);
	const existing = facts.data ?? [];
	const byId = new Map(existing.map((fact) => [fact.id, fact]));
	const imported = new Map(rows.map((row) => [row.source.id, row]));
	const sources = new Set(existing.filter((fact) => fact.source.kind === "import").map((fact) => fact.source.id));
	const knownText = new Set(existing.map((fact) => normalizeFactText(fact.text)));
	const duplicate = (row: Draft) => sources.has(row.source.id) || knownText.has(normalizeFactText(row.text));
	const chosenTexts = new Set<string>();
	const chosen = rows.filter((row) => {
		const key = normalizeFactText(row.text);
		if (
			!row.selected ||
			duplicate(row) ||
			result?.results.some((saved) => saved.sourceId === row.source.id && saved.status === "saved") ||
			chosenTexts.has(key)
		)
			return false;
		chosenTexts.add(key);
		return true;
	});
	const chosenIds = new Set(chosen.map((row) => row.source.id));
	const valid =
		(rows.length > 0 || !!connections?.connections.length) &&
		(!importContacts || !connections?.connections.length || contactsSelection !== null) &&
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
		setMatches(new Map());
		setCorrections(new Map());
		setCorrected(new Set());
		setResult(null);
		setConnections(null);
		setConnectionsWarning("");
		setCareerWarning("");
		setPending(null);
		setImportFacts(true);
		setImportContacts(false);
		setContactsSelection(null);
		setContactsResult(emptyContactsResult());
		savedProfiles.current.clear();
		setError("");
		setNote("");
		if (input.current) input.current.value = "";
	};
	const readFile = async (
		file: File,
		options?: { facts: boolean; contacts: boolean },
		cachedBytes?: Uint8Array<ArrayBuffer>,
	) => {
		const attempt = ++run.current;
		const current = () => attempt === run.current;
		setStep("reading");
		setError("");
		setRows([]);
		setResult(null);
		setConnections(null);
		setConnectionsWarning("");
		setCareerWarning("");
		setPending(null);
		setImportFacts(options?.facts ?? true);
		setImportContacts(options?.contacts ?? false);
		setContactsSelection(null);
		setContactsResult(emptyContactsResult());
		savedProfiles.current.clear();
		setFileName(file.name);
		setNote(t`Reading the file…`);
		try {
			if (file.size > 100 * 1024 * 1024)
				throw new ImportError(t`This file is too large. Use a file smaller than 100 MB.`);
			const bytes = cachedBytes ?? new Uint8Array(await file.arrayBuffer());
			const kind = await detectImportKind(file, bytes);
			if (!kind || kind === "cover-letter-json")
				throw new ImportError(t`Choose a resume PDF, Word file, resume JSON or LinkedIn data export ZIP.`);
			if (kind !== "linkedin" && file.size > 10 * 1024 * 1024)
				throw new ImportError(t`Resume files must be smaller than 10 MB.`);
			if (!current()) return;
			if (kind === "linkedin" && !options) {
				setPending({ file, bytes });
				setStep("options");
				setNote("");
				return;
			}
			const wantsFacts = options?.facts ?? true;
			const wantsContacts = options?.contacts ?? false;
			const digest = wantsFacts
				? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) =>
						byte.toString(16).padStart(2, "0"),
					).join("")
				: "";
			// Contact-only imports must not depend on Knowledge or read profile files.
			const known = wantsFacts
				? await queryClient.fetchQuery({
						...orpc.career.facts.queryOptions({ input: { applicationId: null } }),
						staleTime: 0,
					})
				: [];
			if (wantsFacts)
				await queryClient.fetchQuery({ ...orpc.career.factGroups.queryOptions({ input: {} }), staleTime: 0 });
			if (!current()) return;
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
			let parsedConnections: LinkedInConnectionsFile | null = null;
			if (kind === "linkedin" && wantsContacts) {
				try {
					parsedConnections = readLinkedInConnections(bytes, file.name);
					setConnections(parsedConnections);
				} catch (cause) {
					const message = cause instanceof Error ? cause.message : t`Could not read contacts from this export.`;
					if (!wantsFacts) throw new ImportError(message);
					setConnectionsWarning(message);
				}
			}
			let candidates: ImportFactCandidate[] = [];
			if (wantsFacts) {
				try {
					const data = await readResumeFile(file, kind, {
						bytes,
						aiAvailable,
						onRead: (message) => {
							if (current()) setNote(message);
						},
					});
					if (!current()) return;
					candidates = resumeToFactCandidates(data, digest);
				} catch (cause) {
					if (!current()) return;
					if (!parsedConnections?.connections.length) throw cause;
					setCareerWarning(
						t`No career facts could be read. You can still review and import contacts from this export.`,
					);
				}
			}
			if (!current()) return;
			const comparisons = findImportDuplicates(candidates, known);
			const draft = candidates.map((candidate) => ({
				...candidate,
				selected: candidate.selected && !comparisons.has(candidate.source.id),
			}));
			if (!draft.length && !parsedConnections?.connections.length)
				throw new ImportError(
					wantsFacts
						? t`No career facts were found. Try another file or add facts in Knowledge.`
						: t`No importable contacts were found in this export.`,
				);
			setRows(draft);
			setMatches(comparisons);
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
		if (!valid || busy || corrections.size > 0 || (importFacts && (facts.isError || groups.isError))) return;
		setStep("saving");
		setError("");
		try {
			const saved = chosen.length
				? await client.career.importFacts({
						facts: chosen.map(({ text, category, group, source }) => ({ text: text.trim(), category, group, source })),
					})
				: { results: [] };
			setResult((previous) => ({
				results: [
					...(previous?.results ?? []).filter((row) => !saved.results.some((next) => next.sourceId === row.sourceId)),
					...saved.results,
				],
			}));
			if (importFacts) await queryClient.invalidateQueries({ queryKey: orpc.career.key() });
			if (importContacts && contactsSelection) {
				const prior = contactsResult;
				await saveReviewedContacts(
					{
						...contactsSelection,
						rows: contactsSelection.rows.filter((row) => !savedProfiles.current.has(row.connection.profileUrl)),
					},
					(progress, completed) => {
						for (const profile of completed) savedProfiles.current.add(profile);
						const next = { ...prior };
						for (const key of Object.keys(next) as (keyof ContactsImportResult)[]) next[key] += progress[key];
						setContactsResult(next);
					},
				);
				await queryClient.invalidateQueries({ queryKey: orpc.directory.key() });
			}
			setStep("done");
		} catch (cause) {
			setError(
				getOrpcErrorMessage(cause, {
					fallback: t`Import stopped. Any saved facts or contacts are kept. Your review is still here; use Refresh contact review before retrying.`,
				}),
			);
			setStep("review");
		}
	};
	const update = (id: string, change: Partial<Pick<Draft, "text" | "selected">>) =>
		setRows((previous) => previous.map((row) => (row.source.id === id ? { ...row, ...change } : row)));
	const editExisting = (fact: Fact, text = fact.text) =>
		setCorrections((previous) =>
			new Map(previous).set(fact.id, { text, original: fact.text, saving: false, error: "" }),
		);
	const changeCorrection = (id: string, change: Partial<ImportCorrection>) =>
		setCorrections((previous) => {
			const edit = previous.get(id);
			return edit ? new Map(previous).set(id, { ...edit, ...change }) : previous;
		});
	const cancelCorrection = (id: string) =>
		setCorrections((previous) => {
			const next = new Map(previous);
			next.delete(id);
			return next;
		});
	const saveCorrection = async (id: string) => {
		const edit = corrections.get(id);
		if (!edit || busy || !edit.text.trim()) return;
		changeCorrection(id, { saving: true, error: "" });
		try {
			const current = await queryClient.fetchQuery({
				...orpc.career.facts.queryOptions({ input: { applicationId: null } }),
				staleTime: 0,
			});
			const latest = current.find((fact) => fact.id === id);
			if (!latest || latest.text !== edit.original)
				throw new ImportError(
					t`This fact changed while you were editing. Cancel this correction and check the latest text.`,
				);
			await client.career.updateFact({ id, text: edit.text.trim() });
			queryClient.setQueryData<Fact[]>(orpc.career.facts.queryKey({ input: { applicationId: null } }), (previous) =>
				previous?.map((fact) => (fact.id === id ? { ...fact, text: edit.text.trim() } : fact)),
			);
			setCorrected((previous) => new Set(previous).add(id));
			cancelCorrection(id);
			await queryClient.invalidateQueries({ queryKey: orpc.career.key() });
		} catch (cause) {
			changeCorrection(id, {
				saving: false,
				error:
					cause instanceof ImportError
						? cause.message
						: getOrpcErrorMessage(cause, {
								fallback: t`Couldn't save this correction. Your edit is still here; try again.`,
							}),
			});
		}
	};
	const chooseDuplicate = (row: Draft, include: boolean) => {
		update(row.source.id, { selected: include });
		const other = matches.get(row.source.id)?.[0];
		if (other?.target === "import") update(other.id, { selected: true });
	};
	const recheck = async () => {
		if (busy || corrections.size > 0) return;
		setChecking(true);
		setError("");
		try {
			const current = await queryClient.fetchQuery({
				...orpc.career.facts.queryOptions({ input: { applicationId: null } }),
				staleTime: 0,
			});
			const next = findImportDuplicates(rows, current);
			setRows((previous) =>
				previous.map((row) =>
					next.has(row.source.id) && !matches.has(row.source.id) ? { ...row, selected: false } : row,
				),
			);
			setMatches(next);
		} catch (cause) {
			setError(
				getOrpcErrorMessage(cause, { fallback: t`Couldn't recheck matches. Your review is still here; try again.` }),
			);
		} finally {
			setChecking(false);
		}
	};
	const grouped = new Map<string, Draft[]>();
	const duplicateRows = rows.filter((row) => matches.has(row.source.id));
	for (const row of rows) {
		if (matches.has(row.source.id)) continue;
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
				disabled={busy || step === "options"}
				onChange={(event) => {
					const file = event.target.files?.[0];
					if (file) void readFile(file);
				}}
			/>
			<Dialog
				open={step === "options"}
				onOpenChange={(open) => {
					if (!open) reset();
				}}
			>
				<DialogContent className="sm:max-w-sm" showCloseButton={false}>
					<DialogHeader>
						<DialogTitle>
							<Trans>LinkedIn export detected</Trans>
						</DialogTitle>
						<DialogDescription>
							<Trans>What would you like to import?</Trans>
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-3 py-1">
						<label className="flex cursor-pointer items-center gap-3">
							<input
								type="checkbox"
								className="size-4 accent-accent"
								checked={importFacts}
								onChange={(event) => setImportFacts(event.target.checked)}
							/>
							<span>{t`Import facts`}</span>
						</label>
						<label className="flex cursor-pointer items-center gap-3">
							<input
								type="checkbox"
								className="size-4 accent-accent"
								checked={importContacts}
								onChange={(event) => setImportContacts(event.target.checked)}
							/>
							<span>{t`Import contacts`}</span>
						</label>
					</div>
					<DialogFooter>
						<Button variant="ghost" onClick={reset}>
							<Trans>Cancel</Trans>
						</Button>
						<Button
							disabled={!importFacts && !importContacts}
							onClick={() => {
								if (pending)
									void readFile(pending.file, { facts: importFacts, contacts: importContacts }, pending.bytes);
							}}
						>
							<Trans>Continue</Trans>
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
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
								LinkedIn exports and JSON are read in your browser. We read LinkedIn's profile files, and connections
								can optionally be imported into Directory. Messages are ignored. Only selected facts and contacts are
								saved to your account.
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
						{importFacts && (
							<>
								<p className="text-sm text-ink-2">
									<Trans>
										Review new facts first, then compare duplicates below. Possible duplicates start left out. Hidden
										resume entries start unchecked.
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
									<Button
										size="sm"
										variant="ghost"
										loading={checking}
										disabled={busy || corrections.size > 0}
										onClick={() => void recheck()}
									>
										<Trans>Recheck matches</Trans>
									</Button>
									<span className="text-sm" role="status">
										{plural(chosen.length, { one: "# fact selected", other: "# facts selected" })}
									</span>
								</div>
							</>
						)}
					</div>
					{careerWarning && (
						<p role="status" className="text-sm text-ink-2">
							{careerWarning}
						</p>
					)}
					{connectionsWarning && (
						<p role="alert" className="text-sm">
							{connectionsWarning}
						</p>
					)}
					{connections && (
						<section aria-labelledby="import-contacts" className="grid min-w-0 gap-4 rounded-xl border border-line p-4">
							<h2 id="import-contacts" className="text-lg font-semibold">
								<Trans>LinkedIn contacts</Trans>
							</h2>
							<p className="text-sm text-ink-2">
								{plural(connections.connections.length, {
									one: "# connection found in this export",
									other: "# connections found in this export",
								})}
							</p>

							{!!(
								connections.skipped +
								connections.duplicateRows +
								connections.invalidEmails +
								connections.invalidDates
							) && (
								<p className="text-xs text-ink-3">{t`${connections.skipped} invalid rows skipped; ${connections.duplicateRows} repeated profiles removed; ${connections.invalidEmails} invalid emails and ${connections.invalidDates} invalid connection dates left blank.`}</p>
							)}
							{importContacts && (
								<ContactsImportReview file={connections} disabled={busy} onChange={setContactsSelection} />
							)}
						</section>
					)}
					{importFacts && (facts.isError || groups.isError) && (
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
					{importFacts && (
						<>
							<section aria-labelledby="import-new-facts" className="grid min-w-0 gap-5">
								<header className="grid gap-1">
									<h2 id="import-new-facts" className="text-lg font-semibold">
										<Trans>New facts</Trans>{" "}
										<span className="text-sm font-normal text-ink-3">{rows.length - duplicateRows.length}</span>
									</h2>
									<p className="text-sm text-ink-2">
										<Trans>
											These facts have no close matches in Knowledge or earlier in this file. Edit the text and choose
											what to save.
										</Trans>
									</p>
								</header>
								{grouped.size === 0 && (
									<p className="rounded-lg bg-sunken p-4 text-sm text-ink-2">
										{rows.length ? (
											<Trans>All proposed facts have matches. Review them in Duplicates below.</Trans>
										) : (
											<Trans>No career facts were found in this export.</Trans>
										)}
									</p>
								)}
								{Array.from(grouped).map(([group, entries]) => (
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
							</section>
							<section aria-labelledby="import-duplicates" className="grid min-w-0 gap-4 border-t border-line pt-6">
								<header className="grid gap-1">
									<h2 id="import-duplicates" className="text-lg font-semibold">
										<Trans>Duplicates</Trans>{" "}
										<span className="text-sm font-normal text-ink-3">{duplicateRows.length}</span>
									</h2>
									<p className="text-sm text-ink-2">
										<Trans>
											Compare facts with the same or similar wording. Edit either side, keep the other fact, or keep
											both when they add different details.
										</Trans>
									</p>
								</header>
								{duplicateRows.length === 0 && (
									<p className="rounded-lg bg-sunken p-4 text-sm text-ink-2">
										<Trans>No duplicates found.</Trans>
									</p>
								)}
								{duplicateRows.map((row) => (
									<ImportComparison
										key={row.source.id}
										row={row}
										matches={matches.get(row.source.id) ?? []}
										known={byId}
										imported={imported}
										corrections={corrections}
										corrected={corrected}
										privateGroups={privateGroups}
										busy={busy}
										included={chosenIds.has(row.source.id)}
										canInclude={
											!duplicate(row) &&
											!(matches.get(row.source.id) ?? []).some(
												(match) =>
													match.target === "import" &&
													normalizeFactText(imported.get(match.id)?.text ?? "") === normalizeFactText(row.text),
											)
										}
										onChange={update}
										onChoose={(include) => chooseDuplicate(row, include)}
										onEdit={editExisting}
										onCorrect={(id, text) => changeCorrection(id, { text, error: "" })}
										onSave={(id) => void saveCorrection(id)}
										onCancel={cancelCorrection}
									/>
								))}
							</section>
						</>
					)}
					{chosen.length > 500 && (
						<p role="alert" className="text-sm">
							<Trans>Select up to 500 facts at a time.</Trans>
						</p>
					)}
					<div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] flex flex-wrap items-center gap-3 rounded-xl border border-line bg-raised p-3 shadow-e1 sm:bottom-3">
						<Button
							disabled={!valid || busy || corrections.size > 0 || (importFacts && (facts.isError || groups.isError))}
							loading={step === "saving"}
							onClick={() => void save()}
						>
							{importContacts
								? importFacts
									? t`Import selected facts and contacts`
									: t`Import selected contacts`
								: chosen.length
									? plural(chosen.length, { one: "Save # fact", other: "Save # facts" })
									: t`Finish review`}
						</Button>
						<Button variant="ghost" disabled={busy || corrections.size > 0} onClick={reset}>
							<Trans>Choose another file</Trans>
						</Button>
						{corrections.size > 0 && (
							<p className="text-xs text-ink-3">
								<Trans>Save or cancel your Knowledge corrections before finishing the review.</Trans>
							</p>
						)}
					</div>
				</>
			)}
			{step === "done" && (
				<div className="grid justify-items-start gap-4 rounded-xl border border-line p-6" role="status">
					<h2 className="font-semibold">
						<Trans>Knowledge import complete</Trans>
					</h2>
					{importFacts &&
						(note ? (
							<p className="text-sm">{note}</p>
						) : (
							<>
								<p>{t`${result?.results.filter((row) => row.status === "saved").length ?? 0} facts saved`}</p>
								<p className="text-sm text-ink-2">{t`${rows.length - (result?.results.filter((row) => row.status === "saved").length ?? 0)} facts left out or already in Knowledge`}</p>
								{corrected.size > 0 && (
									<p className="text-sm text-ink-2">{t`${corrected.size} existing facts corrected`}</p>
								)}
							</>
						))}
					{importContacts && (
						<>
							<p className="text-sm">{t`${contactsResult.created} contacts created; ${contactsResult.updated} updated; ${contactsResult.unchanged} unchanged; ${contactsResult.skipped} skipped.`}</p>
							<Link to="/dashboard/directory" search={{ tab: "contacts" }} className="text-sm underline">
								<Trans>View contacts</Trans>
							</Link>
						</>
					)}
					{importFacts && (
						<Link to="/dashboard/career/knowledge/facts" className="text-sm underline">
							<Trans>View facts</Trans>
						</Link>
					)}
					<Button variant="secondary" onClick={reset}>
						<Trans>Import another file</Trans>
					</Button>
				</div>
			)}
		</section>
	);
}
