import type { Fact, Story } from "../hooks";
import type { RouterOutput } from "@/libs/orpc/client";
import type { StoryIssue } from "@reactive-resume/utils/knowledge";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { toast } from "@reactive-resume/ui/components/toast";
import { storyIssues } from "@reactive-resume/utils/knowledge";
import { CareerLoadError, CareerLoading } from "../load-state";
import { useKnowledgeRules } from "./groups";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

type Duplicates = RouterOutput["career"]["duplicates"];
type DuplicateFact = Duplicates["facts"][number];

const DISMISSED_KEY = "curate:not-duplicates";
const readDismissed = () => {
	try {
		return new Set<string>(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]") as string[]);
	} catch {
		return new Set<string>();
	}
};

/** Every query a merge or cleanup changes. */
function useRefreshKnowledge() {
	const queryClient = useQueryClient();
	return () => {
		for (const key of [
			orpc.career.duplicates.key(),
			orpc.career.facts.key(),
			orpc.career.stories.key(),
			orpc.career.factGroups.key(),
			orpc.career.overrides.key(),
		])
			void queryClient.invalidateQueries({ queryKey: key });
	};
}

/** Curate: copies of shared facts in applications, and facts that say the same thing twice. */
export function DuplicatesCard() {
	const id = useId();
	const refresh = useRefreshKnowledge();
	const query = useQuery(orpc.career.duplicates.queryOptions());
	const [dismissed, setDismissed] = useState(readDismissed);
	const [shown, setShown] = useState(10);
	const onError = (error: Error) =>
		toast.add({ type: "error", description: getOrpcErrorMessage(error, { fallback: t`Couldn't merge those facts.` }) });
	const clean = useMutation({
		...orpc.career.cleanDuplicates.mutationOptions(),
		onSuccess: ({ updated }) =>
			toast.add({
				type: "success",
				description: plural(updated, { one: "Removed # copy.", other: "Removed # copies." }),
			}),
		onError,
		onSettled: refresh,
	});
	const merge = useMutation({
		mutationFn: async (input: { into: string; ids: string[] }) => {
			for (const factId of input.ids) await client.career.mergeFact({ id: factId, into: input.into });
		},
		onError,
		onSettled: refresh,
	});

	if (!query.data) return query.isError ? <CareerLoadError onRetry={() => void query.refetch()} /> : <CareerLoading />;
	const facts = new Map(query.data.facts.map((fact) => [fact.id, fact]));
	// Copies private to an application of a shared fact: one click folds them into the shared one.
	const copies = query.data.exact.flatMap((set) =>
		facts.get(set.keep)?.applicationId === null
			? set.copies.filter((factId) => facts.get(factId)?.applicationId !== null)
			: [],
	);
	const sets = query.data.exact
		.map((set) => ({
			keep: set.keep,
			copies: set.copies.filter((factId) => !copies.includes(factId)),
		}))
		.filter((set) => set.copies.length > 0);
	const near = query.data.near.filter((pair) => !dismissed.has(pair.factIds.join(":")));
	const dismiss = (key: string) => {
		const next = new Set(dismissed).add(key);
		setDismissed(next);
		try {
			localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
		} catch {
			// Without storage the pair is only hidden until the page reloads.
		}
	};
	const busy = clean.isPending || merge.isPending;

	return (
		<section aria-labelledby={`${id}-title`} className="overflow-hidden rounded-xl border border-line bg-surface">
			<header className="grid gap-0.5 border-b border-line px-4 py-3">
				<h2 id={`${id}-title`} className="flex items-center gap-2 text-sm font-semibold">
					<Icon name="copy" size={20} className="text-ink-2" />
					<Trans>Duplicates</Trans>
				</h2>
				<p className="text-xs leading-[17px] text-ink-3">
					<Trans>
						A fact said twice takes twice the budget. Keeping one archives the other: it's hidden and never sent, and
						you can restore it from Archived in Facts. Its stories, saved work and per-job choices move to the one you
						keep.
					</Trans>
				</p>
			</header>

			{copies.length === 0 && sets.length === 0 && near.length === 0 && (
				<p className="px-4 py-5 text-center text-sm text-ink-3">
					<Trans>No duplicates found.</Trans>
				</p>
			)}

			{copies.length > 0 && (
				<div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
					<p className="min-w-0 flex-1 basis-60 text-[13px]">
						{plural(copies.length, {
							one: "# application fact is a word-for-word copy of a shared fact, which already reaches that application.",
							other:
								"# application facts are word-for-word copies of shared facts, which already reach those applications.",
						})}
					</p>
					<Button
						size="sm"
						variant="secondary"
						loading={clean.isPending}
						disabled={busy}
						onClick={() => clean.mutate({})}
					>
						<Trans>Remove copies</Trans>
					</Button>
				</div>
			)}

			{sets.map((set) => (
				<div key={set.keep} className="grid gap-2 border-b border-line px-4 py-3 last:border-b-0">
					<p className="text-xs font-medium text-ink-3">{plural(set.copies.length + 1, { other: "Said # times" })}</p>
					<FactQuote fact={facts.get(set.keep)} />
					<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
						<Button
							size="sm"
							variant="secondary"
							disabled={busy}
							loading={merge.isPending && merge.variables.into === set.keep}
							onClick={() => merge.mutate({ into: set.keep, ids: set.copies })}
						>
							{plural(set.copies.length, { one: "Keep one, archive # copy", other: "Keep one, archive # copies" })}
						</Button>
						<span className="text-xs text-ink-3">
							<Trans>Keeps the oldest one that's switched on.</Trans>
						</span>
					</div>
				</div>
			))}

			{near.slice(0, shown).map((pair) => {
				const [left, right] = pair.factIds.map((factId) => facts.get(factId));
				const key = pair.factIds.join(":");
				if (!left || !right) return null;
				const percent = Math.round(pair.similarity * 100);
				// Keeping a job's own fact over a shared one makes it shared, as the server does, so no job loses it.
				const becomesShared = (keep: DuplicateFact, other: DuplicateFact) =>
					keep.applicationId !== null && keep.applicationId !== other.applicationId;
				return (
					<div key={key} className="grid gap-2 border-b border-line px-4 py-3 last:border-b-0">
						<p className="text-xs font-medium text-ink-3">
							{pair.contained
								? t`The longer one says almost everything the shorter one does · ${percent}%`
								: t`Nearly the same words · ${percent}%`}
						</p>
						<div className="grid gap-2 sm:grid-cols-2">
							{[
								[left, right],
								[right, left],
							].map(([keep, other]) =>
								keep && other ? (
									<div key={keep.id} className="grid content-between gap-2 rounded-md bg-sunken px-3 py-2.5">
										<FactQuote fact={keep} />
										<div className="grid justify-items-start gap-1">
											<Button
												size="sm"
												variant="secondary"
												disabled={busy}
												onClick={() => merge.mutate({ into: keep.id, ids: [other.id] })}
											>
												<Trans>Keep this, archive the other</Trans>
											</Button>
											{becomesShared(keep, other) && (
												<span className="text-xs text-ink-3">
													<Trans>This one becomes shared, so every application gets it.</Trans>
												</span>
											)}
										</div>
									</div>
								) : null,
							)}
						</div>
						<Button size="sm" variant="ghost" className="justify-self-start text-ink-2" onClick={() => dismiss(key)}>
							<Trans>Not duplicates, keep both</Trans>
						</Button>
					</div>
				);
			})}
			{near.length > shown && (
				<div className="px-4 py-2.5">
					<Button size="sm" variant="ghost" onClick={() => setShown((count) => count + 10)}>
						{t`Show more (${near.length - shown})`}
					</Button>
				</div>
			)}
		</section>
	);
}

type FactQuoteProps = { fact: DuplicateFact | undefined };

function FactQuote({ fact }: FactQuoteProps) {
	if (!fact) return null;
	const company = fact.company;
	return (
		<div className="grid gap-0.5">
			<p className="text-sm leading-[21px]">{fact.text}</p>
			<p className="text-xs text-ink-3">
				{[
					fact.applicationId === null ? t`All applications` : company ? t`${company} only` : t`One application only`,
					fact.status === "active"
						? t({ message: "switched on", context: "A fact's switch: the AI can read it" })
						: t({ message: "switched off", context: "A fact's switch: the AI can't read it" }),
					fact.group,
				]
					.filter(Boolean)
					.join(" · ")}
			</p>
		</div>
	);
}

const FACTS_INPUT = { applicationId: null, all: true };

/** Curate: stories the AI can't use, why, and a one-step confirmation when a fact behind one was corrected. */
export function StoriesCard() {
	const id = useId();
	const refresh = useRefreshKnowledge();
	const facts = useQuery(orpc.career.facts.queryOptions({ input: FACTS_INPUT }));
	const stories = useQuery(orpc.career.stories.queryOptions({ input: { applicationId: null } }));
	const { rules, loaded, isError, retry } = useKnowledgeRules(null);
	const confirm = useMutation({
		mutationFn: (story: Story) => client.career.saveStory({ ...story.data, id: story.id, applicationId: null }),
		onSuccess: () => toast.add({ type: "success", description: t`Story confirmed. The AI can use it again.` }),
		onError: (error) =>
			toast.add({ type: "error", description: getOrpcErrorMessage(error, { fallback: t`Couldn't save the story.` }) }),
		onSettled: refresh,
	});

	if (!facts.data || !stories.data || !loaded)
		return facts.isError || stories.isError || isError ? (
			<CareerLoadError
				onRetry={() => {
					void facts.refetch();
					void stories.refetch();
					retry();
				}}
			/>
		) : (
			<CareerLoading />
		);
	const byId = new Map<string, Fact>(facts.data.map((fact) => [fact.id, fact]));
	const blocked = stories.data
		.map((story) => ({ story, issues: storyIssues(story, byId, rules) }))
		.filter(({ issues }) => issues.length > 0);

	return (
		<section aria-labelledby={`${id}-title`} className="overflow-hidden rounded-xl border border-line bg-surface">
			<header className="grid gap-0.5 border-b border-line px-4 py-3">
				<h2 id={`${id}-title`} className="flex items-center gap-2 text-sm font-semibold">
					<Icon name="book-open" size={20} className="text-ink-2" />
					<Trans>Stories the AI can't use</Trans>
				</h2>
				<p className="text-xs leading-[17px] text-ink-3">
					<Trans>
						A story reaches the AI only while every fact behind it does, and none was corrected after the story was
						saved.
					</Trans>
				</p>
			</header>
			{blocked.length === 0 ? (
				<p className="px-4 py-5 text-center text-sm text-ink-3">
					<Trans>Every story can be used.</Trans>
				</p>
			) : (
				<ul>
					{blocked.map(({ story, issues }) => {
						const onlyCorrections = issues.every((issue) => issue.reason === "corrected");
						return (
							<li key={story.id} className="grid gap-2 border-b border-line px-4 py-3 last:border-b-0">
								<p className="text-sm font-semibold">{story.data.title}</p>
								<ul className="grid gap-1.5">
									{issues.map((issue) => (
										<li key={`${issue.factId}-${issue.reason}`} className="text-xs leading-[17px] text-ink-2">
											<IssueText issue={issue} fact={byId.get(issue.factId)} />
										</li>
									))}
								</ul>
								<div className="flex flex-wrap gap-1.5">
									{onlyCorrections && (
										<Button
											size="sm"
											variant="secondary"
											loading={confirm.isPending && confirm.variables.id === story.id}
											disabled={confirm.isPending}
											onClick={() => confirm.mutate(story)}
										>
											<Trans>Still true, use it</Trans>
										</Button>
									)}
									<Button
										size="sm"
										variant="ghost"
										nativeButton={false}
										render={
											<Link
												to="/dashboard/career/knowledge/stories/{-$storyId}"
												params={{ storyId: story.id }}
												search={{ edit: true }}
											/>
										}
									>
										<Trans>Edit story</Trans>
									</Button>
								</div>
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}

type IssueTextProps = { issue: StoryIssue; fact: Fact | undefined };

function IssueText({ issue, fact }: IssueTextProps) {
	const quote = fact?.text ?? "";
	switch (issue.reason) {
		case "missing":
			return issue.factId ? (
				<Trans>A fact behind it was forgotten.</Trans>
			) : (
				<Trans>No facts back it. Edit it and tick the facts it rests on.</Trans>
			);
		case "archived":
			return <>{t`Archived: “${quote}”`}</>;
		case "private":
			return <>{t`In a private group: “${quote}”`}</>;
		case "off":
			return <>{t`Switched off: “${quote}”`}</>;
		case "corrected":
			return (
				<span className="grid gap-0.5">
					<span>{t`Corrected after the story was saved:`}</span>
					<span className="text-ink-3 line-through">{issue.before}</span>
					<span>{issue.after}</span>
				</span>
			);
	}
}
