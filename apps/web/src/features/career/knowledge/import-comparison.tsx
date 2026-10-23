import type { Fact } from "../hooks";
import type { ImportDuplicate } from "./import-duplicates";
import type { ImportFactCandidate } from "@reactive-resume/import/facts";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Button } from "@reactive-resume/ui/components/button";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { isPrivateGroup, normalizeFactText } from "@reactive-resume/utils/knowledge";
import { cn } from "@reactive-resume/utils/style";
import { ImportRow, rowLabel } from "./import-fact-row";

export type ImportCorrection = { text: string; original: string; error: string; saving: boolean };
type ImportComparisonProps = {
	row: ImportFactCandidate;
	matches: ImportDuplicate[];
	known: ReadonlyMap<string, Fact>;
	imported: ReadonlyMap<string, ImportFactCandidate>;
	corrections: ReadonlyMap<string, ImportCorrection>;
	corrected: ReadonlySet<string>;
	privateGroups: string[];
	busy: boolean;
	included: boolean;
	canInclude: boolean;
	onChange: (id: string, change: Partial<Pick<ImportFactCandidate, "text" | "selected">>) => void;
	onChoose: (include: boolean) => void;
	onEdit: (fact: Fact, text?: string) => void;
	onCorrect: (id: string, text: string) => void;
	onSave: (id: string) => void;
	onCancel: (id: string) => void;
};

/** Keep comparisons in place while either side is edited so typing never moves the focused field. */
export function ImportComparison(props: ImportComparisonProps) {
	const { row, matches, known, imported, corrections, corrected, privateGroups, busy, included, canInclude } = props;
	const knowledgeMatches = matches.filter((match) => match.target === "knowledge");
	const fileFacts = [
		row,
		...matches.flatMap((match) => {
			const fact = match.target === "import" ? imported.get(match.id) : undefined;
			return fact ? [fact] : [];
		}),
	];
	const originalSource = matches.some((match) => match.kind === "source");
	const identical = matches.some(
		(match) =>
			normalizeFactText(row.text) ===
			normalizeFactText(
				match.target === "knowledge" ? (known.get(match.id)?.text ?? "") : (imported.get(match.id)?.text ?? ""),
			),
	);
	return (
		<article className="grid min-w-0 gap-4 rounded-xl border border-line bg-surface p-4">
			<header className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="text-sm font-semibold">{rowLabel(row)}</h3>
				<span className="rounded-full bg-sunken px-2 py-1 text-xs text-ink-2">
					{originalSource ? (
						<Trans>Imported before</Trans>
					) : identical ? (
						<Trans>Same text</Trans>
					) : (
						<Trans>Possible duplicate</Trans>
					)}
				</span>
			</header>
			<div className={cn("grid min-w-0 gap-4", knowledgeMatches.length > 0 && "lg:grid-cols-2")}>
				<section aria-label={t`From this file`} className="grid min-w-0 content-start gap-3">
					<p className="text-xs font-semibold text-ink-2">
						<Trans>From this file</Trans> <span className="font-normal text-ink-3">({fileFacts.length})</span>
					</p>
					{fileFacts.map((fact, index) => (
						<fieldset key={fact.source.id} disabled={busy} className="min-w-0">
							<ImportRow
								row={fact}
								duplicate={false}
								showSelection={false}
								textLabel={index === 0 ? t`Imported fact text` : t`Other imported fact text`}
								onChange={(change) => props.onChange(fact.source.id, change)}
							/>
						</fieldset>
					))}
				</section>
				{knowledgeMatches.length > 0 && (
					<section aria-label={t`In Knowledge`} className="grid min-w-0 content-start gap-3">
						<p className="text-xs font-semibold text-ink-2">
							<Trans>In Knowledge</Trans>
						</p>
						{knowledgeMatches.map((match) => {
							const fact = known.get(match.id);
							if (!fact)
								return (
									<p key={match.id} className="text-sm text-ink-2">
										<Trans>This fact is no longer available. Recheck matches before saving.</Trans>
									</p>
								);
							const edit = corrections.get(fact.id);
							return (
								<div key={fact.id} className="grid min-w-0 gap-2">
									<div className="grid min-w-0 gap-3 rounded-lg bg-sunken p-3">
										<p className="text-xs text-ink-3">
											{[
												fact.group,
												fact.status === "archived"
													? t`Archived`
													: fact.status === "excluded"
														? t`Coaching off`
														: t`Coaching on`,
												isPrivateGroup(fact.group, privateGroups) ? t`Private` : null,
											]
												.filter(Boolean)
												.join(" · ")}
										</p>
										{edit ? (
											<>
												<Textarea
													aria-label={t`Existing fact text`}
													value={edit.text}
													maxLength={2000}
													disabled={busy}
													onChange={(event) => props.onCorrect(fact.id, event.target.value)}
												/>
												{edit.error && (
													<p role="alert" className="text-sm">
														{edit.error}
													</p>
												)}
												<p className="text-xs text-ink-3">
													<Trans>Saving corrects the existing fact now. Linked stories may need review.</Trans>
												</p>
												<div className="flex flex-wrap gap-2">
													<Button
														size="sm"
														variant="secondary"
														loading={edit.saving}
														disabled={busy || !edit.text.trim() || edit.text.trim() === fact.text}
														onClick={() => props.onSave(fact.id)}
													>
														<Trans>Save correction</Trans>
													</Button>
													<Button size="sm" variant="ghost" disabled={busy} onClick={() => props.onCancel(fact.id)}>
														<Trans>Cancel correction</Trans>
													</Button>
												</div>
											</>
										) : (
											<>
												<p className="text-sm leading-relaxed whitespace-pre-wrap">{fact.text}</p>
												<div className="flex flex-wrap items-center gap-2">
													<Button size="sm" variant="ghost" disabled={busy} onClick={() => props.onEdit(fact)}>
														<Trans>Edit existing fact</Trans>
													</Button>
													<Button
														size="sm"
														variant="ghost"
														className="h-auto max-w-full py-1 text-start whitespace-normal"
														disabled={busy || !row.text.trim() || row.text.trim() === fact.text}
														onClick={() => props.onEdit(fact, row.text)}
													>
														{t`Use wording from ${rowLabel(row)}`}
													</Button>
													{corrected.has(fact.id) && (
														<span role="status" className="text-xs text-ink-2">
															<Trans>Correction saved</Trans>
														</span>
													)}
												</div>
											</>
										)}
									</div>
								</div>
							);
						})}
					</section>
				)}
			</div>
			<footer className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
				<Button
					size="sm"
					variant={included ? "ghost" : "secondary"}
					aria-pressed={!included}
					disabled={busy}
					onClick={() => props.onChoose(false)}
				>
					<Trans>Keep the other fact</Trans>
				</Button>
				<Button
					size="sm"
					variant={included ? "secondary" : "ghost"}
					aria-pressed={included}
					disabled={busy || !canInclude}
					onClick={() => props.onChoose(true)}
				>
					<Trans>Keep both</Trans>
				</Button>
				{!canInclude && (
					<p className="text-xs text-ink-3">
						{originalSource ? (
							<Trans>This source was already imported. Edit the fact in Knowledge to correct it.</Trans>
						) : (
							<Trans>Identical copies are skipped. Edit the imported text to keep a distinct fact.</Trans>
						)}
					</p>
				)}
			</footer>
		</article>
	);
}
