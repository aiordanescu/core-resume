import type { RouterOutput } from "@/libs/orpc/client";
import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { toast } from "@reactive-resume/ui/components/toast";
import { groupAncestors } from "@reactive-resume/utils/knowledge";
import { CareerLoadError, CareerLoading } from "../load-state";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

export type FactGroup = RouterOutput["career"]["factGroups"][number];

export type GroupNode = {
	path: string;
	name: string;
	depth: number;
	/** How this group itself was last switched; null when it follows its parent or was never switched. */
	status: FactGroup["status"];
	/** Its own facts and every subgroup's. */
	facts: { active: number; excluded: number };
	activeChars: number;
};

/** Groups as a tree in path order, each with its subgroups' facts counted in, including parents with no facts of their own. */
export function groupTree(groups: readonly FactGroup[]): GroupNode[] {
	const nodes = new Map<string, GroupNode>();
	for (const entry of groups) {
		if (entry.group === null) continue;
		for (const path of groupAncestors(entry.group)) {
			let node = nodes.get(path);
			if (!node) {
				const parts = path.split("/");
				nodes.set(
					path,
					(node = {
						path,
						name: parts.at(-1) ?? path,
						depth: parts.length - 1,
						status: null,
						facts: { active: 0, excluded: 0 },
						activeChars: 0,
					}),
				);
			}
			node.facts.active += entry.facts.active;
			node.facts.excluded += entry.facts.excluded;
			node.activeChars += entry.activeChars;
			if (path === entry.group) node.status = entry.status;
		}
	}
	// Siblings sort by name under their parent: "a/b" before "a b", which plain string order would swap.
	return [...nodes.values()].sort((a, b) => {
		const left = a.path.split("/");
		const right = b.path.split("/");
		for (let index = 0; index < Math.min(left.length, right.length); index++) {
			const order = (left[index] ?? "").localeCompare(right[index] ?? "");
			if (order !== 0) return order;
		}
		return left.length - right.length;
	});
}

/** Curate: switch whole groups of facts on or off, with how much each one adds to the budget. */
export function GroupsCard() {
	const { i18n } = useLingui();
	const id = useId();
	const queryClient = useQueryClient();
	const query = useQuery(orpc.career.factGroups.queryOptions());
	const number = new Intl.NumberFormat(i18n.locale);
	const toggle = useMutation({
		...orpc.career.setFactGroupStatus.mutationOptions(),
		onSuccess: ({ updated }, { group, status }) =>
			toast.add({
				type: "success",
				description:
					status === "active"
						? plural(updated, {
								one: `Switched # fact in ${group} on.`,
								other: `Switched # facts in ${group} on.`,
							})
						: plural(updated, {
								one: `Switched # fact in ${group} off.`,
								other: `Switched # facts in ${group} off.`,
							}),
			}),
		onError: (error) =>
			toast.add({
				type: "error",
				description: getOrpcErrorMessage(error, { fallback: t`Couldn't switch that group.` }),
			}),
		onSettled: () => {
			void queryClient.invalidateQueries({ queryKey: orpc.career.factGroups.key() });
			void queryClient.invalidateQueries({ queryKey: orpc.career.facts.key() });
			void queryClient.invalidateQueries({ queryKey: orpc.career.stories.key() });
		},
	});

	if (!query.data) return query.isError ? <CareerLoadError onRetry={() => void query.refetch()} /> : <CareerLoading />;
	const tree = groupTree(query.data);
	const ungrouped = query.data.find((entry) => entry.group === null);

	return (
		<section aria-labelledby={`${id}-title`} className="overflow-hidden rounded-xl border border-line bg-surface">
			<header className="grid gap-0.5 border-b border-line px-4 py-3">
				<h2 id={`${id}-title`} className="flex items-center gap-2 text-sm font-semibold">
					<Icon name="folder-simple" size={20} className="text-ink-2" />
					<Trans>Groups</Trans>
				</h2>
				<p className="text-xs leading-[17px] text-ink-3">
					<Trans>
						Switch a whole group on or off, subgroups included. Facts you add to a group later start the way the group
						was last switched. Put a fact in a group from its row in Facts.
					</Trans>
				</p>
			</header>
			{tree.length === 0 ? (
				<p className="px-4 py-5 text-center text-sm text-ink-3">
					<Trans>No groups yet. Give a fact a group in Facts, or set one through the API.</Trans>
				</p>
			) : (
				<ul>
					{tree.map((node) => {
						const total = node.facts.active + node.facts.excluded;
						const pending = toggle.isPending && toggle.variables?.group === node.path;
						return (
							<li
								key={node.path}
								className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-4 py-2.5 last:border-b-0"
								style={{ paddingInlineStart: `${16 + node.depth * 20}px` }}
							>
								<div className="grid min-w-0 flex-1 basis-48 gap-0.5">
									<p className="truncate text-sm font-medium" title={node.path}>
										{node.name}
									</p>
									<p className="text-xs text-ink-3">
										{t`${number.format(node.facts.active)} on · ${number.format(node.facts.excluded)} off · ${number.format(node.activeChars)} characters`}
										{node.status === "excluded" && <> · {t`new facts start off`}</>}
									</p>
								</div>
								<div className="flex gap-1.5">
									<GroupButton
										label={t`Switch all on`}
										name={t`Switch ${node.path} on`}
										disabled={total === 0 || (node.facts.excluded === 0 && node.status !== "excluded")}
										pending={pending && toggle.variables?.status === "active"}
										onClick={() => toggle.mutate({ group: node.path, status: "active", subgroups: true })}
									/>
									<GroupButton
										label={t`Switch all off`}
										name={t`Switch ${node.path} off`}
										disabled={total === 0 || (node.facts.active === 0 && node.status === "excluded")}
										pending={pending && toggle.variables?.status === "excluded"}
										onClick={() => toggle.mutate({ group: node.path, status: "excluded", subgroups: true })}
									/>
								</div>
							</li>
						);
					})}
				</ul>
			)}
			{ungrouped && (
				<p className="border-t border-line px-4 py-2.5 text-xs text-ink-3">
					{t`Not in a group: ${number.format(ungrouped.facts.active)} on · ${number.format(ungrouped.facts.excluded)} off`}
				</p>
			)}
		</section>
	);
}

type GroupButtonProps = { label: string; name: string; disabled: boolean; pending: boolean; onClick: () => void };

function GroupButton({ label, name, disabled, pending, onClick }: GroupButtonProps) {
	return (
		<Button
			variant="secondary"
			size="sm"
			aria-label={name}
			disabled={disabled}
			loading={pending}
			onClick={onClick}
			className="h-7 px-2.5 text-xs"
		>
			{label}
		</Button>
	);
}
