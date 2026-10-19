import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { Switch } from "@reactive-resume/ui/components/switch";
import { toast } from "@reactive-resume/ui/components/toast";
import { groupTree } from "../knowledge/groups";
import { Eyebrow } from "../shared";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type ApplicationKnowledgeProps = { applicationId: string };

/**
 * Which groups and facts this application's AI work reads beyond the global switches: private groups it includes, and
 * groups it includes or leaves out. Nothing is copied, so a correction to a fact applies here too.
 */
export function ApplicationKnowledge({ applicationId }: ApplicationKnowledgeProps) {
	const id = useId();
	const queryClient = useQueryClient();
	const groups = useQuery(orpc.career.factGroups.queryOptions());
	const overrides = useQuery(orpc.career.overrides.queryOptions({ input: { applicationId } }));
	const facts = useQuery(orpc.career.facts.queryOptions({ input: { applicationId: null, all: true } }));
	const [picked, setPicked] = useState("");
	const refresh = () => {
		void queryClient.invalidateQueries({ queryKey: orpc.career.overrides.key() });
		void queryClient.invalidateQueries({ queryKey: orpc.career.savedItems.key() });
	};
	const onError = (error: Error) =>
		toast.add({
			type: "error",
			description: getOrpcErrorMessage(error, { fallback: t`Couldn't change this application's Knowledge.` }),
		});
	const save = useMutation({ ...orpc.career.saveOverride.mutationOptions(), onError, onSettled: refresh });
	const remove = useMutation({ ...orpc.career.deleteOverride.mutationOptions(), onError, onSettled: refresh });

	if (!groups.data || !overrides.data) return null;
	const tree = groupTree(groups.data);
	if (tree.length === 0 && overrides.data.length === 0) return null;
	const byGroup = new Map(overrides.data.flatMap((row) => (row.group ? [[row.group, row] as const] : [])));
	// Top-level private groups: the ones an application asks for.
	const privateGroups = tree.filter((node) => node.private && !node.privateFromParent);
	const others = overrides.data.filter(
		(row) => row.factId !== null || !privateGroups.some((node) => node.path === row.group && row.mode === "include"),
	);
	const factText = (factId: string) => facts.data?.find((fact) => fact.id === factId)?.text ?? t`A fact`;
	const choices = tree.filter((node) => !byGroup.has(node.path));
	const pending = save.isPending || remove.isPending;

	return (
		<section aria-labelledby={`${id}-title`} className="grid gap-2">
			<Eyebrow>
				<span id={`${id}-title`}>
					<Trans>Knowledge for this job</Trans>
				</span>
			</Eyebrow>
			<div className="grid gap-2.5 rounded-xl border border-line bg-surface p-3.5">
				{privateGroups.map((node) => {
					const included = byGroup.get(node.path);
					return (
						<div key={node.path} className="flex items-center gap-2.5 text-[13px]">
							<Icon name="lock" size={16} className="flex-none text-ink-3" />
							<span className="min-w-0 flex-1">
								<span className="block truncate font-medium">{node.path}</span>
								<span className="block text-xs text-ink-3">
									{included?.mode === "include" ? t`Included for this job` : t`Private, not sent`}
								</span>
							</span>
							<Switch
								checked={included?.mode === "include"}
								disabled={pending}
								aria-label={t`Include ${node.path} for this job`}
								onCheckedChange={(checked) =>
									checked
										? save.mutate({ applicationId, group: node.path, mode: "include" })
										: included && remove.mutate({ id: included.id })
								}
							/>
						</div>
					);
				})}

				{others.map((row) => (
					<div key={row.id} className="flex items-center gap-2.5 text-[13px]">
						<Icon name={row.factId ? "list-checks" : "folder-simple"} size={16} className="flex-none text-ink-3" />
						<span className="min-w-0 flex-1">
							<span className="block truncate font-medium">{row.factId ? factText(row.factId) : row.group}</span>
							<span className="block text-xs text-ink-3">
								{row.mode === "include" ? t`Included for this job` : t`Left out for this job`}
							</span>
						</span>
						<Button
							size="sm"
							variant="ghost"
							className="h-7 text-ink-2"
							disabled={pending}
							onClick={() => remove.mutate({ id: row.id })}
						>
							<Trans>Undo</Trans>
						</Button>
					</div>
				))}

				{choices.length > 0 && (
					<div className="flex flex-wrap items-center gap-1.5">
						<div className="min-w-0 flex-1 basis-32">
							<NativeSelect
								aria-label={t`Another group`}
								value={picked}
								onChange={(event) => setPicked(event.target.value)}
								className="h-8 w-full text-[13px]"
							>
								<option value="">{t`Another group…`}</option>
								{choices.map((node) => (
									<option key={node.path} value={node.path}>
										{node.path}
									</option>
								))}
							</NativeSelect>
						</div>
						<Button
							size="sm"
							variant="secondary"
							className="h-8"
							disabled={!picked || pending}
							onClick={() => {
								save.mutate({ applicationId, group: picked, mode: "include" });
								setPicked("");
							}}
						>
							<Trans>Include</Trans>
						</Button>
						<Button
							size="sm"
							variant="ghost"
							className="h-8 text-ink-2"
							disabled={!picked || pending}
							onClick={() => {
								save.mutate({ applicationId, group: picked, mode: "exclude" });
								setPicked("");
							}}
						>
							<Trans>Leave out</Trans>
						</Button>
					</div>
				)}
			</div>
			<p className="text-xs text-ink-3">
				<Trans>Only this job's Fit, Apply, Prepare and coach use these. Nothing is copied.</Trans>
			</p>
		</section>
	);
}
