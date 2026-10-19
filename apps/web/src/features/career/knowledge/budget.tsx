import type { ReactNode } from "react";
import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { toast } from "@reactive-resume/ui/components/toast";
import { knowledgeBudget, reachesAi, storyHolds } from "@reactive-resume/utils/knowledge";
import { cn } from "@reactive-resume/utils/style";
import { CareerLoadError, CareerLoading } from "../load-state";
import { useKnowledgeRules } from "./groups";
import { contextWindow, modelSuggestionsQuery } from "@/features/settings/ai/catalog";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

const FACTS_INPUT = { applicationId: null, all: true };

/**
 * The shared Knowledge that reaches the AI (switched-on facts, and stories still backed by them) measured against the
 * AI limits and the default connection's context window.
 */
export function useKnowledgeBudget() {
	const facts = useQuery(orpc.career.facts.queryOptions({ input: FACTS_INPUT }));
	const stories = useQuery(orpc.career.stories.queryOptions({ input: { applicationId: null } }));
	const limits = useQuery(orpc.career.aiLimits.queryOptions());
	const knowledge = useKnowledgeRules(null);
	const { usableProviders } = useHasUsableAiProvider();
	const catalog = useQuery(modelSuggestionsQuery);
	// The list is in the server's automatic order, so the first usable connection is the one actions use.
	const provider = usableProviders[0] ?? null;
	const listed = provider ? contextWindow(catalog.data, provider.provider, provider.model) : null;
	const contextTokens = provider?.contextTokens ?? listed;

	const queries = [facts, stories, limits];
	if (!facts.data || !stories.data || !limits.data || !knowledge.loaded)
		return {
			budget: null,
			provider,
			isError: queries.some((query) => query.isError) || knowledge.isError,
			retry: () => {
				queries.forEach((query) => void query.refetch());
				knowledge.retry();
			},
		} as const;
	// Private groups never reach the AI outside an application that includes them.
	const active = facts.data.filter((fact) => fact.applicationId === null && reachesAi(fact, knowledge.rules));
	const usable = new Map(active.map((fact) => [fact.id, fact]));
	return {
		budget: knowledgeBudget({
			facts: active,
			stories: stories.data.filter((story) => storyHolds(story, usable)),
			limits: limits.data,
			contextTokens,
		}),
		provider,
		/** Where the context window came from: set by hand, models.dev, or unknown. */
		contextSource: provider?.contextTokens ? "manual" : listed ? "catalog" : "unknown",
		isError: false,
		retry: () => undefined,
	} as const;
}

type BudgetMeterProps = { showSettingsLink?: boolean; bare?: boolean };

/** How much of the AI limits the switched-on Knowledge uses, and whether the limits fit the model. */
export function BudgetMeter({ showSettingsLink = false, bare = false }: BudgetMeterProps) {
	const { i18n } = useLingui();
	const id = useId();
	const state = useKnowledgeBudget();
	const number = new Intl.NumberFormat(i18n.locale);
	if (!state.budget) return state.isError ? <CareerLoadError onRetry={state.retry} /> : <CareerLoading />;
	const { budget, provider } = state;
	const n = (value: number) => number.format(value);

	return (
		<section
			aria-labelledby={`${id}-title`}
			className={cn("grid gap-3.5", !bare && "rounded-xl border border-line bg-surface px-4 py-3.5")}
		>
			<header className="flex flex-wrap items-center gap-2">
				<Icon name="gauge" size={20} className="text-ink-2" />
				<h2 id={`${id}-title`} className="flex-1 text-sm font-semibold">
					<Trans>Knowledge budget</Trans>
				</h2>
				{showSettingsLink && (
					<Link
						to="/dashboard/settings/ai"
						className="text-xs text-ink-3 underline underline-offset-2 transition-colors duration-quick hover:text-ink"
					>
						<Trans>Change AI limits</Trans>
					</Link>
				)}
			</header>

			<div className="grid gap-3 sm:grid-cols-2">
				<Meter
					label={t`Facts in each action`}
					used={budget.facts.chars}
					budget={budget.facts.budget}
					detail={t`${plural(budget.facts.count, { one: "# fact switched on", other: "# facts switched on" })} · ${n(budget.facts.chars)} of ${n(budget.facts.budget)} characters`}
				/>
				<Meter
					label={t`Stories in each action`}
					used={budget.stories.chars}
					budget={budget.stories.budget}
					detail={t`${plural(budget.stories.count, { one: "# usable story", other: "# usable stories" })} · ${n(budget.stories.chars)} of ${n(budget.stories.budget)} characters`}
				/>
			</div>

			<p className="text-xs leading-[17px] text-ink-2">
				{t`The Coach shares up to ${n(budget.coach.facts.limit)} of ${n(budget.coach.facts.count)} facts and ${n(budget.coach.stories.limit)} of ${n(budget.coach.stories.count)} stories with each message, best matches first.`}
			</p>

			{budget.overBudget && (
				<Notice tone="info">
					<Trans>
						Over budget: each action sends the facts and stories that best match the posting first and leaves out the
						rest.
					</Trans>
				</Notice>
			)}

			<div className="grid gap-1.5 border-t border-line pt-3 text-xs leading-[17px] text-ink-2">
				<p>
					{t`An action sends about ${n(budget.tokens.used)} tokens with this Knowledge, and up to ${n(budget.tokens.budget)} with full budgets, counting about four characters a token and the posting, notes and documents.`}
				</p>
				{provider ? (
					<ContextLine
						providerId={provider.id}
						managed={provider.managed}
						model={provider.model}
						tokens={budget.tokens.context}
						source={state.contextSource}
					/>
				) : (
					<p className="text-ink-3">
						<Trans>Connect an AI provider to compare this with its model's context window.</Trans>
					</p>
				)}
				{budget.overContext && (
					<Notice tone="warn">
						<Trans>
							The budget is larger than this model's context window. Lower the AI limits, or the model may cut off or
							refuse long requests.
						</Trans>
					</Notice>
				)}
			</div>
		</section>
	);
}

type MeterProps = { label: string; used: number; budget: number; detail: string };

function Meter({ label, used, budget, detail }: MeterProps) {
	const over = used > budget;
	const share = budget > 0 ? Math.min(used / budget, 1) : 1;
	return (
		<div className="grid gap-1.5">
			<div className="flex items-baseline justify-between gap-2 text-xs">
				<span className="font-medium text-ink-2">{label}</span>
				<span className={cn("font-mono", over ? "text-warn-text" : "text-ink-3")}>
					{over ? t`${Math.round((used / budget) * 10) / 10}× budget` : `${Math.round(share * 100)}%`}
				</span>
			</div>
			<div
				role="meter"
				aria-label={label}
				aria-valuemin={0}
				aria-valuemax={budget}
				aria-valuenow={Math.min(used, budget)}
				aria-valuetext={detail}
				className="h-1.5 overflow-hidden rounded-full bg-sunken"
			>
				<div
					className={cn("h-full rounded-full", over ? "bg-warn" : "bg-accent")}
					style={{ width: `${share * 100}%` }}
				/>
			</div>
			<p className="text-xs text-ink-3">{detail}</p>
		</div>
	);
}

type NoticeProps = { tone: "info" | "warn"; children: ReactNode };

function Notice({ tone, children }: NoticeProps) {
	return (
		<p
			className={cn(
				"flex items-start gap-1.5 rounded-md px-2.5 py-2 text-xs leading-[17px]",
				tone === "warn" ? "bg-warn-soft text-warn-text" : "bg-info-soft text-info-text",
			)}
		>
			<Icon name={tone === "warn" ? "warning" : "info"} size={16} className="mt-px flex-none" />
			<span>{children}</span>
		</p>
	);
}

type ContextLineProps = {
	providerId: string;
	managed: boolean;
	model: string;
	tokens: number | null;
	source: "manual" | "catalog" | "unknown";
};

/** The default connection's context window, with a field to set it when models.dev doesn't list the model. */
function ContextLine({ providerId, managed, model, tokens, source }: ContextLineProps) {
	const { i18n } = useLingui();
	const queryClient = useQueryClient();
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(tokens ? String(tokens) : "");
	const save = useMutation({
		...orpc.aiProviders.update.mutationOptions(),
		onSuccess: () => {
			setEditing(false);
			void queryClient.invalidateQueries({ queryKey: orpc.aiProviders.list.key() });
		},
		onError: (error) =>
			toast.add({
				type: "error",
				description: getOrpcErrorMessage(error, { fallback: t`Couldn't save the context window.` }),
			}),
	});
	const value = Number(draft);
	const valid = Number.isInteger(value) && value >= 1000 && value <= 100_000_000;
	const formatted = tokens === null ? "" : new Intl.NumberFormat(i18n.locale).format(tokens);

	if (editing)
		return (
			<form
				className="flex flex-wrap items-center gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					if (valid) save.mutate({ id: providerId, contextTokens: value });
				}}
			>
				<label htmlFor={`${providerId}-context`}>{t`Context window of ${model}`}</label>
				<Input
					id={`${providerId}-context`}
					type="number"
					inputMode="numeric"
					min={1000}
					step={1}
					value={draft}
					aria-invalid={draft !== "" && !valid ? true : undefined}
					onChange={(event) => setDraft(event.target.value)}
					className="h-8 w-32"
				/>
				<span className="text-ink-3">
					<Trans>tokens</Trans>
				</span>
				<Button type="submit" size="sm" variant="secondary" className="h-8" disabled={!valid} loading={save.isPending}>
					<Trans>Save</Trans>
				</Button>
				{source === "manual" && (
					<Button
						type="button"
						size="sm"
						variant="ghost"
						className="h-8 text-ink-2"
						onClick={() => save.mutate({ id: providerId, contextTokens: null })}
					>
						<Trans>Look it up instead</Trans>
					</Button>
				)}
				<Button type="button" size="sm" variant="ghost" className="h-8 text-ink-2" onClick={() => setEditing(false)}>
					<Trans>Cancel</Trans>
				</Button>
			</form>
		);

	return (
		<p className="flex flex-wrap items-center gap-x-2 gap-y-1">
			<span>
				{source === "unknown"
					? t`models.dev doesn't list ${model}, so its context window is unknown.`
					: source === "manual"
						? t`${model} reads up to ${formatted} tokens (set by you).`
						: t`${model} reads up to ${formatted} tokens (from models.dev).`}
			</span>
			{!managed && (
				<button
					type="button"
					onClick={() => setEditing(true)}
					className="text-ink-3 underline underline-offset-2 transition-colors duration-quick hover:text-ink"
				>
					{source === "unknown" ? <Trans>Set it</Trans> : <Trans>Change</Trans>}
				</button>
			)}
		</p>
	);
}
