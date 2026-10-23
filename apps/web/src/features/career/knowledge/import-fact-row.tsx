import type { ImportFactCandidate } from "@reactive-resume/import/facts";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";

type Draft = ImportFactCandidate;

export const rowLabel = (row: Draft) =>
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

type ImportRowProps = {
	row: Draft;
	duplicate: boolean;
	showSelection?: boolean;
	textLabel?: string;
	onChange: (change: Partial<Pick<Draft, "text" | "selected">>) => void;
};
export function ImportRow({ row, duplicate, onChange, showSelection = true, textLabel }: ImportRowProps) {
	return (
		<div className="grid min-w-0 gap-2 rounded-lg border border-line p-3">
			<div className="flex items-center gap-2 text-sm">
				{showSelection && (
					<input
						type="checkbox"
						aria-label={t`Include ${rowLabel(row)}`}
						checked={row.selected && !duplicate}
						disabled={duplicate}
						onChange={(event) => onChange({ selected: event.target.checked })}
					/>
				)}
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
			</div>
			<textarea
				aria-label={textLabel ?? t`Fact text`}
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
