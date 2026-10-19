import type { Application } from "../types";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";

type ViewPostingButtonProps = { application: Application; size?: "default" | "sm"; className?: string };

/**
 * "View posting": opens the saved posting in a dialog, or the posting's page when only a link was saved. Renders
 * nothing when there is neither. The detail sheet and the workspace header both use it, so they behave the same.
 */
export function ViewPostingButton({ application, size = "default", className }: ViewPostingButtonProps) {
	const [open, setOpen] = useState(false);
	if (!application.sourceUrl && !application.jobDescription) return null;

	if (application.sourceUrl && !application.jobDescription) {
		return (
			<a
				href={application.sourceUrl}
				target="_blank"
				rel="noreferrer"
				className={cn(buttonVariants({ variant: "secondary", size }), className)}
			>
				<Icon name="file-text" size={size === "sm" ? 16 : 18} />
				<Trans>View posting</Trans>
				<Icon name="arrow-square-out" size={14} className="text-ink-3" />
			</a>
		);
	}

	return (
		<>
			<Button variant="secondary" size={size} className={className} onClick={() => setOpen(true)}>
				<Icon name="file-text" size={size === "sm" ? 16 : 18} />
				<Trans>View posting</Trans>
			</Button>
			<PostingDialog application={application} open={open} onOpenChange={setOpen} />
		</>
	);
}

type PostingDialogProps = { application: Application; open: boolean; onOpenChange: (open: boolean) => void };

/** The saved posting: its link, what it asks for, and its text. */
function PostingDialog({ application, open, onOpenChange }: PostingDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>
						{application.role} · {application.company}
					</DialogTitle>
					<DialogDescription>
						{application.sourceUrl ? (
							<a
								href={application.sourceUrl}
								target="_blank"
								rel="noreferrer"
								className="text-accent-text hover:underline"
							>
								{application.sourceUrl}
							</a>
						) : (
							<Trans>The posting saved with this application.</Trans>
						)}
					</DialogDescription>
				</DialogHeader>
				{application.postingSource && (
					<p className="text-xs text-ink-3">
						{application.postingSource.method === "paste" ? (
							<Trans>Pasted description</Trans>
						) : (
							<Trans>
								Retrieved {application.postingSource.retrievedAt} using {application.postingSource.method}. Retrieval
								time does not establish origin freshness.
							</Trans>
						)}
					</p>
				)}
				{(application.postingSource?.truncated || application.postingSource?.completeness === "incomplete") && (
					<p className="text-xs text-warn-text" role="alert">
						<Trans>This saved description is clipped or incomplete. Review before preparing documents.</Trans>
					</p>
				)}
				{application.requirements.length > 0 && (
					<section aria-labelledby="posting-requirements" className="grid gap-2">
						<h3 id="posting-requirements" className="text-xs font-semibold text-ink-3 uppercase">
							<Trans>What it asks for</Trans>
						</h3>
						<ul className="flex flex-wrap gap-1.5">
							{application.requirements.map((requirement) => (
								<li key={requirement} className="rounded-md bg-sunken px-2 py-1 text-xs">
									{requirement}
								</li>
							))}
						</ul>
					</section>
				)}
				{application.jobDescription && (
					<p className="text-sm leading-6 whitespace-pre-wrap text-ink-2">{application.jobDescription}</p>
				)}
			</DialogContent>
		</Dialog>
	);
}
