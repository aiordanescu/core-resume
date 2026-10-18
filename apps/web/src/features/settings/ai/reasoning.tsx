import type { AiReasoning, AiReasoningEffort } from "@reactive-resume/ai/reasoning";
import type { AIProvider } from "@reactive-resume/ai/types";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useId, useState } from "react";
import { acceptsCustomReasoning, AI_REASONING_EFFORTS } from "@reactive-resume/ai/reasoning";
import { Label } from "@reactive-resume/ui/components/label";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { SwitchRow } from "@reactive-resume/ui/components/switch";

const effortLabel = (effort: AiReasoningEffort) =>
	({
		minimal: t`Minimal`,
		low: t`Low`,
		medium: t`Medium`,
		high: t`High`,
		xhigh: t`Extra high`,
		max: t`Max`,
		ultra: t`Ultra`,
	})[effort];

/** "Thinking off" or "Thinking: High", for a connection's row; Model default shows nothing. */
export const reasoningSummary = (reasoning: AiReasoning) =>
	reasoning === "none" ? t`Thinking off` : t`Thinking: ${effortLabel(reasoning)}`;

/** The efforts a provider can be sent: Ultra only where it passes through as-is. */
export const effortsFor = (provider: AIProvider) =>
	AI_REASONING_EFFORTS.filter((effort) => effort !== "ultra" || acceptsCustomReasoning(provider));

type ReasoningFieldProps = {
	provider: AIProvider;
	/** Null is Model default: nothing is sent. */
	value: AiReasoning | null;
	onChange: (value: AiReasoning | null) => void;
};

/** Model default, then thinking on or off, then how hard it thinks; sent with every request on this connection. */
export function ReasoningField({ provider, value, onChange }: ReasoningFieldProps) {
	const id = useId();
	const efforts = effortsFor(provider);
	// Switching thinking back on returns to the last effort chosen here.
	const [lastEffort, setLastEffort] = useState<AiReasoningEffort>(
		value && value !== "none" && efforts.includes(value) ? value : "medium",
	);
	const thinking = value !== null && value !== "none";
	const effort = thinking && efforts.includes(value) ? value : lastEffort;

	return (
		<fieldset className="grid gap-1 sm:col-span-2">
			<legend className="mb-1 text-sm font-medium">
				<Trans>Reasoning</Trans>
			</legend>
			<SwitchRow
				label={<Trans>Model default</Trans>}
				description={
					<Trans>
						Sends nothing, so the model or server decides how much it thinks. Some think at their highest effort when
						nothing is sent, which makes every request slower.
					</Trans>
				}
				checked={value === null}
				onCheckedChange={(checked) => onChange(checked ? null : lastEffort)}
			/>
			<SwitchRow
				label={<Trans>Thinking</Trans>}
				description={<Trans>Off answers straight away. On thinks first, at the effort below.</Trans>}
				checked={thinking}
				disabled={value === null}
				onCheckedChange={(checked) => onChange(checked ? lastEffort : "none")}
			/>
			<div className="flex items-center justify-between gap-4 py-2">
				<Label htmlFor={`${id}-effort`} className={thinking ? undefined : "text-ink-3"}>
					<Trans>Effort</Trans>
				</Label>
				<NativeSelect
					id={`${id}-effort`}
					className="w-40"
					value={effort}
					disabled={!thinking}
					onChange={(event) => {
						const next = efforts.find((item) => item === event.target.value);
						if (!next) return;
						setLastEffort(next);
						onChange(next);
					}}
				>
					{efforts.map((item) => (
						<option key={item} value={item}>
							{effortLabel(item)}
						</option>
					))}
				</NativeSelect>
			</div>
			<p className="text-xs leading-5 text-ink-3">
				{provider === "openai-compatible" || provider === "openrouter" ? (
					<Trans>
						Sent as reasoning_effort, or none for thinking off. Ultra goes as-is, for servers that accept it. A model
						that doesn't support a setting fails its test.
					</Trans>
				) : (
					<Trans>Translated for this provider. A model that doesn't support a setting fails its test.</Trans>
				)}
			</p>
		</fieldset>
	);
}
