import type { AiLimits } from "@reactive-resume/schema/career";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { aiLimitsSchema } from "@reactive-resume/schema/career";
import { Button } from "@reactive-resume/ui/components/button";
import { Input } from "@reactive-resume/ui/components/input";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { toast } from "@reactive-resume/ui/components/toast";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

const DEFAULTS = aiLimitsSchema.parse({});
type Field = keyof AiLimits;

const bounds = (field: Field) => {
	const shape = aiLimitsSchema.shape[field].unwrap();
	return { min: shape.minValue ?? 0, max: shape.maxValue ?? Number.MAX_SAFE_INTEGER };
};

/** One limit in a group: its field, its label and the unit after the input. */
type LimitSpec = { name: Field; label: ReactNode; unit: string };
type LimitGroup = { legend: ReactNode; description?: ReactNode; limits: LimitSpec[] };

/** How much Knowledge goes with each AI request and how long it may run. Larger limits suit larger, slower models. */
export function AiLimitsSection() {
	const id = useId();
	const characters = t`characters`;
	const seconds = t`seconds`;

	return (
		<section aria-labelledby={`${id}-title`} className="overflow-hidden rounded-xl border border-line bg-surface">
			<header className="grid gap-1 border-b border-line px-5 py-4 max-sm:px-4">
				<h2 id={`${id}-title`} className="text-[17px] font-semibold">
					<Trans>AI limits</Trans>
				</h2>
				<p className="max-w-[60ch] text-[13px] leading-5 text-ink-3">
					<Trans>
						How much of your switched-on Knowledge goes with each AI request, and how long a request may run. The
						defaults suit fast models with small context windows; raise them for models that can read more or need more
						time. Larger Knowledge limits send more of your Knowledge to your AI provider.
					</Trans>
				</p>
			</header>
			<AiLimitsForm
				groups={[
					{
						legend: <Trans>Coach</Trans>,
						limits: [
							{ name: "coachFacts", label: <Trans>Facts shared with each message</Trans>, unit: t`facts` },
							{ name: "coachStories", label: <Trans>Stories shared with each message</Trans>, unit: t`stories` },
							{
								name: "searchFactChars",
								label: <Trans>Facts returned by one knowledge search</Trans>,
								unit: characters,
							},
							{
								name: "searchStoryChars",
								label: <Trans>Stories returned by one knowledge search</Trans>,
								unit: characters,
							},
						],
					},
					{
						legend: <Trans>Application actions</Trans>,
						description: (
							<Trans>
								Fit, Apply, Prepare, Practise, Debrief and Messages. Facts that best match the posting go in first.
							</Trans>
						),
						limits: [
							{ name: "actionFactChars", label: <Trans>Facts in one request</Trans>, unit: characters },
							{ name: "actionStoryChars", label: <Trans>Stories in one request</Trans>, unit: characters },
							{ name: "actionTimeoutSeconds", label: <Trans>Time limit for one request</Trans>, unit: seconds },
						],
					},
					{
						legend: <Trans>Coach and Assistant replies</Trans>,
						description: (
							<Trans>
								A reply can call the model several times, with tools in between. One call never runs longer than the
								whole reply.
							</Trans>
						),
						limits: [
							{ name: "replyTimeoutSeconds", label: <Trans>Time limit for a whole reply</Trans>, unit: seconds },
							{ name: "replyStepTimeoutSeconds", label: <Trans>Time limit for one model call</Trans>, unit: seconds },
						],
					},
					{
						legend: <Trans>Voice</Trans>,
						limits: [
							{
								name: "transcriptionTimeoutSeconds",
								label: <Trans>Time limit for turning speech into text</Trans>,
								unit: seconds,
							},
							{ name: "speechTimeoutSeconds", label: <Trans>Time limit for reading text aloud</Trans>, unit: seconds },
						],
					},
				]}
			/>
		</section>
	);
}

type AiLimitsFormProps = { groups: LimitGroup[] };

/**
 * Edits some of the AI limits. Each section owns only its own fields: a save sends the latest saved copy with this
 * section's fields replaced, so two sections never undo each other's changes.
 */
export function AiLimitsForm({ groups }: AiLimitsFormProps) {
	const query = useQuery(orpc.career.aiLimits.queryOptions());
	if (query.data) return <LimitsForm initial={query.data} groups={groups} />;
	if (query.isError)
		return (
			<div className="flex flex-wrap items-center gap-3 px-5 py-4 text-sm text-ink-2 max-sm:px-4">
				<Trans>Couldn't load your AI limits.</Trans>
				<Button size="sm" variant="secondary" onClick={() => void query.refetch()}>
					<Trans>Retry</Trans>
				</Button>
			</div>
		);
	return (
		<div className="flex justify-center px-5 py-6">
			<Spinner />
		</div>
	);
}

type LimitsFormProps = { initial: AiLimits; groups: LimitGroup[] };

function LimitsForm({ initial, groups }: LimitsFormProps) {
	const { i18n } = useLingui();
	const queryClient = useQueryClient();
	const queryKey = orpc.career.aiLimits.queryKey();
	const fields = groups.flatMap((group) => group.limits.map((limit) => limit.name));
	/** What the user is typing, per field; an empty or partial number stays editable until it's valid. */
	const toDraft = (limits: AiLimits) =>
		Object.fromEntries(fields.map((field) => [field, String(limits[field])])) as Partial<Record<Field, string>>;
	const [draft, setDraft] = useState(() => toDraft(initial));
	const [saved, setSaved] = useState(initial);
	const save = useMutation(
		orpc.career.saveAiLimits.mutationOptions({
			onSuccess: (limits) => {
				setSaved(limits);
				setDraft(toDraft(limits));
				queryClient.setQueryData(queryKey, limits);
				toast.add({ type: "success", description: t`AI limits saved.` });
			},
			onError: (error) =>
				toast.add({
					type: "error",
					description: getOrpcErrorMessage(error, { fallback: t`Couldn't save your AI limits.` }),
				}),
		}),
	);

	const value = (field: Field) => draft[field] ?? "";
	const invalid = (field: Field) => {
		const number = Number(value(field));
		const { min, max } = bounds(field);
		return value(field).trim() === "" || !Number.isInteger(number) || number < min || number > max;
	};
	const valid = fields.every((field) => !invalid(field));
	const dirty = fields.some((field) => Number(value(field)) !== saved[field]);
	const atDefaults = fields.every((field) => Number(value(field)) === DEFAULTS[field]);
	const number = new Intl.NumberFormat(i18n.locale);

	return (
		<form
			className="grid gap-5 px-5 py-4 max-sm:px-4"
			onSubmit={(event) => {
				event.preventDefault();
				if (!valid) return;
				const latest = queryClient.getQueryData<AiLimits>(queryKey) ?? saved;
				save.mutate({ ...latest, ...Object.fromEntries(fields.map((field) => [field, Number(value(field))])) });
			}}
		>
			{groups.map((group, index) => (
				<fieldset key={index} className="grid gap-3">
					<legend className="mb-1 text-sm font-medium">{group.legend}</legend>
					{group.description && <p className="-mt-1 text-[13px] text-ink-3">{group.description}</p>}
					<div className="grid gap-3 sm:grid-cols-2">
						{group.limits.map(({ name, label, unit }) => (
							<LimitField
								key={name}
								name={name}
								label={label}
								unit={unit}
								value={value(name)}
								invalid={invalid(name)}
								hint={t`Default ${number.format(DEFAULTS[name])}. From ${number.format(bounds(name).min)} to ${number.format(bounds(name).max)}.`}
								onChange={(next) => setDraft((current) => ({ ...current, [name]: next }))}
							/>
						))}
					</div>
				</fieldset>
			))}

			<div className="flex flex-wrap items-center justify-end gap-2">
				<Button
					type="button"
					variant="ghost"
					disabled={atDefaults || save.isPending}
					onClick={() => setDraft(toDraft(DEFAULTS))}
				>
					<Trans>Reset to defaults</Trans>
				</Button>
				<Button type="submit" disabled={!dirty || !valid || save.isPending} aria-busy={save.isPending}>
					{save.isPending ? <Spinner /> : <Trans>Save</Trans>}
				</Button>
			</div>
		</form>
	);
}

type LimitFieldProps = {
	name: Field;
	label: ReactNode;
	unit: string;
	value: string;
	invalid: boolean;
	hint: string;
	onChange: (value: string) => void;
};

function LimitField({ name, label, unit, value, invalid, hint, onChange }: LimitFieldProps) {
	const id = useId();
	const { min, max } = bounds(name);

	return (
		<div className="grid content-start gap-1.5">
			<label htmlFor={id} className="text-xs font-medium text-ink-2">
				{label}
			</label>
			<div className="flex items-center gap-2">
				<Input
					id={id}
					type="number"
					inputMode="numeric"
					min={min}
					max={max}
					step={1}
					value={value}
					aria-invalid={invalid || undefined}
					aria-describedby={`${id}-hint`}
					onChange={(event) => onChange(event.target.value)}
					className="w-36"
				/>
				<span className="text-[13px] text-ink-3">{unit}</span>
			</div>
			<p id={`${id}-hint`} className={invalid ? "text-xs text-danger-text" : "text-xs text-ink-3"}>
				{hint}
			</p>
		</div>
	);
}
