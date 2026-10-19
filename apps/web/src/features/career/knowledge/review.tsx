import type { Fact } from "../hooks";
import type { KnowledgeFinding } from "@reactive-resume/schema/career";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { toast } from "@reactive-resume/ui/components/toast";
import { useDefaultProvider } from "../hooks";
import { CareerLoadError, CareerLoading } from "../load-state";
import { PrivacyLine, useCareerTime, Working } from "../shared";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

const FACTS_INPUT = { applicationId: null, all: true };

const kindLabel = (kind: KnowledgeFinding["kind"]) =>
	({
		contradiction: t`These disagree`,
		superseded: t`A newer fact replaces an older one`,
		unsupported: t`Nothing to check it by`,
	})[kind];

/**
 * Curate: an AI read of the shared facts for contradictions, figures a newer fact replaces and claims with nothing
 * behind them. Copies of shared facts are removed first; only judgment calls are listed, for the user to decide.
 */
export function ReviewCard() {
	const id = useId();
	const queryClient = useQueryClient();
	const { format } = useCareerTime();
	const connection = useDefaultProvider();
	const review = useQuery(orpc.career.review.queryOptions());
	const facts = useQuery(orpc.career.facts.queryOptions({ input: FACTS_INPUT }));
	const refresh = () => {
		for (const key of [
			orpc.career.review.key(),
			orpc.career.facts.key(),
			orpc.career.stories.key(),
			orpc.career.duplicates.key(),
			orpc.career.factGroups.key(),
		])
			void queryClient.invalidateQueries({ queryKey: key });
	};
	const run = useMutation({
		...orpc.career.runReview.mutationOptions(),
		onSuccess: (result) => queryClient.setQueryData(orpc.career.review.queryKey(), result),
		onError: (error) =>
			toast.add({ type: "error", description: getOrpcErrorMessage(error, { fallback: t`The review didn't finish.` }) }),
		onSettled: refresh,
	});
	const resolve = useMutation({
		mutationFn: async (input: { finding: KnowledgeFinding; archive: string[]; resolved: "fixed" | "dismissed" }) => {
			for (const factId of input.archive) await client.career.updateFact({ id: factId, status: "archived" });
			return client.career.resolveFinding({ id: input.finding.id, resolved: input.resolved });
		},
		onSuccess: (result) => queryClient.setQueryData(orpc.career.review.queryKey(), result),
		onError: (error) =>
			toast.add({
				type: "error",
				description: getOrpcErrorMessage(error, { fallback: t`Couldn't save that change.` }),
			}),
		onSettled: refresh,
	});

	if (review.isPending || facts.isPending) return <CareerLoading />;
	if (review.isError || facts.isError)
		return (
			<CareerLoadError
				onRetry={() => {
					void review.refetch();
					void facts.refetch();
				}}
			/>
		);
	const byId = new Map<string, Fact>(facts.data.map((fact) => [fact.id, fact]));
	const last = review.data;
	// A finding goes away once it's settled, or once a fact in it is archived or forgotten.
	const open =
		last?.findings.filter(
			(finding) =>
				finding.resolved === null &&
				finding.factIds.every((factId) => {
					const status = byId.get(factId)?.status;
					return status === "active" || status === "excluded";
				}),
		) ?? [];

	return (
		<section aria-labelledby={`${id}-title`} className="overflow-hidden rounded-xl border border-line bg-surface">
			<header className="grid gap-2 border-b border-line px-4 py-3">
				<div className="flex flex-wrap items-center gap-2">
					<h2 id={`${id}-title`} className="flex flex-1 items-center gap-2 text-sm font-semibold">
						<Icon name="sparkle" size={20} className="text-ink-2" />
						<Trans>Knowledge review</Trans>
					</h2>
					{connection.provider && (
						<Button size="sm" variant="secondary" loading={run.isPending} onClick={() => run.mutate({})}>
							{last ? <Trans>Review again</Trans> : <Trans>Review my Knowledge</Trans>}
						</Button>
					)}
				</div>
				<p className="text-xs leading-[17px] text-ink-3">
					<Trans>
						Removes copies of shared facts, then asks your AI connection which facts disagree, which a newer fact
						replaces, and which claim a result with nothing to check it by. You decide what to do with each.
					</Trans>
				</p>
				{connection.provider ? (
					<PrivacyLine>
						{t`Sends your shared, switched-on facts to ${connection.provider.label}, in requests within your AI limits. Private groups and switched-off facts are never sent.`}
					</PrivacyLine>
				) : (
					!connection.isUnavailable && (
						<Link
							to="/dashboard/settings/ai"
							className="flex w-fit items-center gap-1.5 text-[13px] text-accent-text underline-offset-4 hover:underline"
						>
							<Icon name="key" size={16} />
							<Trans>Connect an AI provider in Settings</Trans>
						</Link>
					)
				)}
			</header>

			{run.isPending && (
				<div className="px-4 py-4">
					<Working steps={[t`Removing copies`, t`Reading your facts`, t`Checking for conflicts`]} />
				</div>
			)}

			{last && !run.isPending && (
				<>
					<p className="border-b border-line px-4 py-2.5 text-xs text-ink-3">
						{t`Last review ${format(last.at, { day: "numeric", month: "short" })} on ${last.connection}: read ${last.reviewed} of ${last.total} facts.`}{" "}
						{last.cleaned > 0 && plural(last.cleaned, { one: "Removed # copy.", other: "Removed # copies." })}
						{last.reviewed < last.total && <> {t`Raise "Facts in each action" in AI limits to read the rest.`}</>}
					</p>
					{open.length === 0 ? (
						<p className="px-4 py-5 text-center text-sm text-ink-3">
							<Trans>Nothing left to decide.</Trans>
						</p>
					) : (
						<ul>
							{open.map((finding) => (
								<li key={finding.id} className="grid gap-2 border-b border-line px-4 py-3 last:border-b-0">
									<p className="text-xs font-medium text-ink-3">{kindLabel(finding.kind)}</p>
									<p className="text-sm">{finding.note}</p>
									<ul className="grid gap-1.5">
										{finding.factIds.map((factId) => (
											<li
												key={factId}
												className="flex flex-wrap items-center gap-2 rounded-md bg-sunken px-3 py-2 text-[13px]"
											>
												<span className="min-w-0 flex-1 basis-60">
													{byId.get(factId)?.text}
													{finding.keep === factId && <span className="ms-1.5 text-xs text-ink-3">{t`(newer)`}</span>}
												</span>
												{finding.kind !== "unsupported" && (
													<Button
														size="sm"
														variant="ghost"
														className="h-7"
														disabled={resolve.isPending}
														onClick={() => resolve.mutate({ finding, archive: [factId], resolved: "fixed" })}
													>
														<Trans>Archive this one</Trans>
													</Button>
												)}
												{finding.kind === "unsupported" && (
													<Button
														size="sm"
														variant="ghost"
														className="h-7"
														nativeButton={false}
														render={<Link to="/dashboard/career/knowledge/facts" search={{ highlight: factId }} />}
													>
														<Trans>Correct it</Trans>
													</Button>
												)}
											</li>
										))}
									</ul>
									<div className="flex flex-wrap gap-1.5">
										{finding.kind === "superseded" && finding.keep && (
											<Button
												size="sm"
												variant="secondary"
												disabled={resolve.isPending}
												onClick={() =>
													resolve.mutate({
														finding,
														archive: finding.factIds.filter((factId) => factId !== finding.keep),
														resolved: "fixed",
													})
												}
											>
												<Trans>Keep the newer one</Trans>
											</Button>
										)}
										<Button
											size="sm"
											variant="ghost"
											className="text-ink-2"
											disabled={resolve.isPending}
											onClick={() => resolve.mutate({ finding, archive: [], resolved: "dismissed" })}
										>
											<Trans>Not a problem</Trans>
										</Button>
									</div>
								</li>
							))}
						</ul>
					)}
				</>
			)}
		</section>
	);
}
