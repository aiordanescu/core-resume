import type { RouterOutput } from "@/libs/orpc/client";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Input } from "@reactive-resume/ui/components/input";
import { orpc } from "@/libs/orpc/client";
type Contact = RouterOutput["directory"]["contacts"][number];
// Shared picker keeps agency recruiters and contacts without a company available in every application.
type ContactPickerProps = { disabled?: boolean; onSelect: (contact: Contact) => void };
export function ContactPicker({ disabled, onSelect }: ContactPickerProps) {
	const [search, setSearch] = useState("");
	const id = useId();
	const query = useQuery(orpc.directory.contacts.queryOptions({ input: {} }));
	const results = search.trim()
		? query.data
				?.filter((row) => `${row.name} ${row.position}`.toLowerCase().includes(search.toLowerCase()))
				.slice(0, 10)
		: [];
	return (
		<div className="grid gap-1">
			<Input
				aria-label={t`Find a directory contact`}
				placeholder={t`Find a directory contact`}
				value={search}
				disabled={disabled}
				onChange={(event) => setSearch(event.target.value)}
				aria-controls={id}
			/>
			<div id={id} className="grid gap-1">
				{results?.map((row) => (
					<Button
						key={row.id}
						type="button"
						variant="ghost"
						className="h-auto justify-start text-start whitespace-normal"
						disabled={disabled}
						onClick={() => {
							onSelect(row);
							setSearch("");
						}}
					>
						{row.name}
						{row.position && ` · ${row.position}`}
					</Button>
				))}
			</div>
			{query.isError && (
				<p role="alert" className="text-xs text-danger-text">
					<Trans>Could not load contacts.</Trans>
				</p>
			)}
		</div>
	);
}
