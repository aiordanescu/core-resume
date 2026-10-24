import type { LinkedInConnectionsFile } from "@reactive-resume/import/linkedin-connections";
import type { LinkedInCompanyChoice, LinkedInImport } from "@reactive-resume/schema/directory-import";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useState } from "react";
import { directoryKey } from "@reactive-resume/schema/directory";
import {
	indexLinkedInContacts,
	matchLinkedInCompany,
	matchLinkedInContact,
} from "@reactive-resume/schema/directory-import";
import { Button } from "@reactive-resume/ui/components/button";
import { Input } from "@reactive-resume/ui/components/input";
import { cn } from "@reactive-resume/utils/style";
import { client, orpc } from "@/libs/orpc/client";

export type ContactsImportSelection = LinkedInImport;
export type ContactsImportResult = Awaited<ReturnType<typeof client.directory.importLinkedIn>>;
export const emptyContactsResult = (): ContactsImportResult => ({
	created: 0,
	updated: 0,
	unchanged: 0,
	skipped: 0,
	companiesCreated: 0,
});

/** Only selected contacts leave the browser. A retried batch cannot create URL duplicates. */
export async function saveReviewedContacts(
	selection: ContactsImportSelection,
	onProgress: (result: ContactsImportResult, completed: string[]) => void,
) {
	const total = emptyContactsResult();
	for (let start = 0; start < selection.rows.length; start += 500) {
		const rows = selection.rows.slice(start, start + 500);
		const needed = new Set(rows.map((row) => directoryKey(row.connection.company)));
		const saved = await client.directory.importLinkedIn({
			...selection,
			rows,
			companies: selection.companies.filter((company) => needed.has(directoryKey(company.sourceName))),
		});
		for (const key of Object.keys(total) as (keyof ContactsImportResult)[]) total[key] += saved[key];
		onProgress(
			{ ...total },
			selection.rows.slice(0, start + rows.length).map((row) => row.connection.profileUrl),
		);
	}
	return total;
}

type ContactsImportReviewProps = {
	file: LinkedInConnectionsFile;
	disabled: boolean;
	onChange: (selection: ContactsImportSelection | null) => void;
};

/** Embedded in Knowledge's one-file review. Merely opening this review never writes contacts. */
export function ContactsImportReview({ file, disabled, onChange }: ContactsImportReviewProps) {
	const contacts = useQuery(orpc.directory.contacts.queryOptions({ input: {}, staleTime: 0 }));
	const companies = useQuery(orpc.directory.companies.queryOptions({ input: {}, staleTime: 0 }));
	const [choices, setChoices] = useState<Record<string, string>>({});
	const [companyEdits, setCompanyEdits] = useState<Record<string, LinkedInCompanyChoice>>({});
	const [included, setIncluded] = useState<Record<string, boolean>>({});
	const [filter, setFilter] = useState("all");
	const [page, setPage] = useState(0);
	const [companyPage, setCompanyPage] = useState(0);
	const listId = useId();
	const contactIndex = useMemo(() => indexLinkedInContacts(contacts.data ?? []), [contacts.data]);
	const companyNames = useMemo(
		() => [
			...new Map(
				file.connections.filter((row) => row.company).map((row) => [directoryKey(row.company), row.company]),
			).values(),
		],
		[file],
	);
	const mappings = useMemo(
		() =>
			companyNames.map((sourceName) => {
				const edited = Object.hasOwn(companyEdits, directoryKey(sourceName))
					? companyEdits[directoryKey(sourceName)]
					: undefined;
				const match = matchLinkedInCompany(sourceName, companies.data ?? []);
				return {
					choice: edited ?? { sourceName, companyId: match.exact?.id ?? null, name: match.exact?.name ?? sourceName },
					suggestions: match.suggestions,
				};
			}),
		[companyNames, companyEdits, companies.data],
	);
	const rows = useMemo(
		() =>
			file.connections.map((connection) => {
				const match = matchLinkedInContact(connection, contactIndex);
				const target =
					choices[connection.profileUrl] ??
					(match.kind === "update" ? (match.contact?.id ?? "") : match.kind === "new" ? "create" : "");
				const checked = included[connection.profileUrl] ?? match.kind !== "duplicate";
				return { connection, match, target, checked, action: checked ? target : "skip" };
			}),
		[file, contactIndex, choices, included],
	);
	const contactsById = useMemo(() => new Map(contacts.data?.map((contact) => [contact.id, contact])), [contacts.data]);
	const selected = useMemo(
		() =>
			rows.flatMap(({ connection, match, action }): LinkedInImport["rows"] => {
				if (action === "skip") return [];
				if (action === "create")
					return [
						{ connection, action: "create", ...(match.kind === "duplicate" ? { duplicateDecision: "separate" } : {}) },
					];
				const person = contactsById.get(action);
				return person
					? [
							{
								connection,
								action: "update",
								contactId: person.id,
								expectedUpdatedAt: new Date(person.updatedAt),
								...(match.kind === "duplicate" ? { duplicateDecision: "merge" } : {}),
							},
						]
					: [];
			}),
		[rows, contactsById],
	);
	const selection = useMemo(
		() =>
			contacts.isPending ||
			contacts.isError ||
			companies.isPending ||
			companies.isError ||
			rows.some((row) => row.checked && !row.target) ||
			mappings.some((mapping) => !mapping.choice.name.trim())
				? null
				: { rows: selected, companies: mappings.map((mapping) => mapping.choice), importEmails: true },
		[selected, mappings, rows, contacts.isPending, contacts.isError, companies.isPending, companies.isError],
	);
	useEffect(() => {
		onChange(selection);
	}, [selection, onChange]);
	useEffect(() => () => onChange(null), [onChange]);
	const names = new Map(companies.data?.map((company) => [company.id, company.name]));
	const visible = rows.filter((row) => filter === "all" || row.match.kind === filter);
	const editCompany = (sourceName: string, name: string) => {
		const existing = companies.data?.find((company) => directoryKey(company.name) === directoryKey(name));
		setCompanyEdits((previous) => ({
			...previous,
			[directoryKey(sourceName)]: { sourceName, name, companyId: existing?.id ?? null },
		}));
	};
	if (contacts.isError || companies.isError)
		return (
			<div role="alert" className="grid justify-items-start gap-2">
				<p>
					<Trans>Could not load Directory. Retry to review contacts, or leave contact import unchecked.</Trans>
				</p>
				<Button
					variant="secondary"
					disabled={disabled}
					onClick={() => {
						void contacts.refetch();
						void companies.refetch();
					}}
				>
					<Trans>Refresh contact review</Trans>
				</Button>
			</div>
		);
	if (contacts.isPending || companies.isPending)
		return (
			<p role="status">
				<Trans>Loading contacts and companies…</Trans>
			</p>
		);
	return (
		<div className="grid min-w-0 gap-5">
			<p className="text-sm text-ink-2">
				<Trans>
					Profile URLs match existing contacts. Possible name duplicates start skipped. Review company names before
					saving. Blank company or position fields keep existing values; notes, tags, phone numbers, and last-contacted
					dates stay as you set them.
				</Trans>
			</p>
			<div className="flex flex-wrap gap-3 text-sm">
				<span>
					{plural(rows.filter((row) => row.match.kind === "new").length, {
						one: "# new contact",
						other: "# new contacts",
					})}
				</span>
				<span>
					{plural(rows.filter((row) => row.match.kind === "update").length, {
						one: "# existing contact to update",
						other: "# existing contacts to update",
					})}
				</span>
				<span>
					{plural(rows.filter((row) => row.match.kind === "duplicate").length, {
						one: "# possible duplicate",
						other: "# possible duplicates",
					})}
				</span>
			</div>

			{mappings.length > 0 && (
				<details className="rounded-lg border border-line p-3" open>
					<summary className="cursor-pointer font-semibold">
						<Trans>Company matching</Trans> ({mappings.length})
					</summary>
					<p className="my-2 text-xs text-ink-2">
						<Trans>
							Choose an existing company or type a new name. Give variants the same company name to combine them.
							Suggested matches are not applied automatically.
						</Trans>
					</p>
					<datalist id={listId}>
						{companies.data?.map((company) => (
							<option key={company.id} value={company.name} />
						))}
					</datalist>
					<div className="grid gap-3">
						{mappings.slice(companyPage * 25, (companyPage + 1) * 25).map(({ choice, suggestions }) => (
							<div key={choice.sourceName} className="grid gap-1 sm:grid-cols-2">
								<span className="self-center text-sm">{choice.sourceName}</span>
								<div className="grid gap-1">
									<Input
										aria-label={t`Company for ${choice.sourceName}`}
										value={choice.name}
										list={listId}
										maxLength={300}
										disabled={disabled}
										onChange={(event) => editCompany(choice.sourceName, event.target.value)}
									/>
									<span className="text-xs text-ink-3">
										{choice.companyId ? t`Use existing company` : t`Use this company name`}
									</span>
									{!choice.companyId &&
										suggestions.map((company) => (
											<Button
												key={company.id}
												type="button"
												variant="ghost"
												size="sm"
												className="justify-start"
												disabled={disabled}
												onClick={() => editCompany(choice.sourceName, company.name)}
											>{t`Use ${company.name}`}</Button>
										))}
								</div>
							</div>
						))}
					</div>
					{mappings.length > 25 && (
						<Pagination
							page={companyPage}
							total={mappings.length}
							size={25}
							disabled={disabled}
							onChange={setCompanyPage}
						/>
					)}
				</details>
			)}
			<div className="flex flex-wrap items-center gap-2">
				<Button
					variant="ghost"
					size="sm"
					disabled={disabled}
					onClick={() => {
						void contacts.refetch();
						void companies.refetch();
					}}
				>
					<Trans>Refresh contact review</Trans>
				</Button>
				<label className="text-sm">
					<Trans>Show contacts</Trans>
					<select
						className="ms-2 rounded-md border border-line bg-surface px-2 py-1"
						disabled={disabled}
						value={filter}
						onChange={(event) => {
							setFilter(event.target.value);
							setPage(0);
						}}
					>
						<option value="all">{t`All`}</option>
						<option value="new">{t`New`}</option>
						<option value="update">{t`Updates`}</option>
						<option value="duplicate">{t`Possible duplicates`}</option>
					</select>
				</label>
				<Button variant="ghost" size="sm" disabled={disabled} onClick={() => setIncluded({})}>
					<Trans>Select new and matched contacts</Trans>
				</Button>
				<Button
					variant="ghost"
					size="sm"
					disabled={disabled}
					onClick={() => setIncluded(Object.fromEntries(rows.map((row) => [row.connection.profileUrl, false])))}
				>
					<Trans>Skip all contacts</Trans>
				</Button>
			</div>
			<div className="grid gap-3 md:grid-cols-2">
				{visible.slice(page * 50, (page + 1) * 50).map(({ connection, match, target, checked }) => (
					<article
						key={connection.profileUrl}
						className={cn(
							"grid content-start gap-3 rounded-lg border p-4",
							checked ? "border-accent/30 bg-raised" : "border-line",
						)}
					>
						<label htmlFor={`${listId}-${connection.profileUrl}`} className="flex cursor-pointer items-start gap-3">
							<input
								type="checkbox"
								id={`${listId}-${connection.profileUrl}`}
								aria-label={t`Import ${connection.name}`}
								checked={checked}
								disabled={disabled}
								className="mt-0.5 size-4 shrink-0 accent-accent"
								onChange={(event) =>
									setIncluded((previous) => ({ ...previous, [connection.profileUrl]: event.target.checked }))
								}
							/>
							<span className="grid min-w-0 gap-1">
								<span className="font-medium">{connection.name}</span>
								<span className="text-xs text-ink-3">
									{match.kind === "new"
										? t`New contact`
										: match.kind === "update"
											? t`Update existing contact`
											: t`Possible duplicate`}
								</span>
							</span>
						</label>
						<div className="grid min-w-0 gap-1 ps-7.5 text-sm">
							{(connection.position || connection.company) && (
								<p className="text-ink-2">{[connection.position, connection.company].filter(Boolean).join(" · ")}</p>
							)}
							{connection.email && <p className="break-all text-ink-2">{connection.email}</p>}
							<div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs">
								<a
									href={connection.profileUrl}
									target="_blank"
									rel="noreferrer"
									className="text-accent-text hover:underline"
								>
									<Trans>Open LinkedIn profile</Trans>
								</a>
								{connection.connectedOn && (
									<span className="text-ink-3">{t`Connected: ${connection.connectedOn}`}</span>
								)}
							</div>
						</div>
						{match.kind === "duplicate" && checked && (
							<div className="grid gap-2 border-t border-line pt-3 text-sm">
								<p className="text-xs text-ink-2">
									<Trans>Choose an existing contact to update or create a separate person.</Trans>
								</p>
								<fieldset disabled={disabled} className="grid gap-2">
									<legend className="sr-only">{t`Match for ${connection.name}`}</legend>
									{match.candidates.map((candidate) => (
										<label
											key={candidate.id}
											htmlFor={`${listId}-${connection.profileUrl}-${candidate.id}`}
											className="flex cursor-pointer items-start gap-2"
										>
											<input
												type="radio"
												id={`${listId}-${connection.profileUrl}-${candidate.id}`}
												name={`${listId}-${connection.profileUrl}-match`}
												value={candidate.id}
												checked={target === candidate.id}
												className="mt-0.5 size-4 shrink-0 accent-accent"
												onChange={() =>
													setChoices((previous) => ({ ...previous, [connection.profileUrl]: candidate.id }))
												}
											/>
											<span>
												{t`Update ${candidate.name}`}
												{"companyId" in candidate &&
												typeof candidate.companyId === "string" &&
												names.get(candidate.companyId)
													? ` · ${names.get(candidate.companyId)}`
													: ""}
											</span>
										</label>
									))}
									{match.identities.length === 0 && (
										<label
											htmlFor={`${listId}-${connection.profileUrl}-create`}
											className="flex cursor-pointer items-center gap-2"
										>
											<input
												type="radio"
												id={`${listId}-${connection.profileUrl}-create`}
												name={`${listId}-${connection.profileUrl}-match`}
												value="create"
												checked={target === "create"}
												className="size-4 shrink-0 accent-accent"
												onChange={() => setChoices((previous) => ({ ...previous, [connection.profileUrl]: "create" }))}
											/>
											<span>{t`Create separate contact`}</span>
										</label>
									)}
								</fieldset>
							</div>
						)}
					</article>
				))}
			</div>
			{visible.length > 50 && (
				<Pagination page={page} total={visible.length} size={50} disabled={disabled} onChange={setPage} />
			)}
			<p className="text-sm font-medium">
				{plural(selected.length, { one: "# contact selected", other: "# contacts selected" })}
			</p>
		</div>
	);
}

type PaginationProps = {
	page: number;
	total: number;
	size: number;
	disabled: boolean;
	onChange: (page: number) => void;
};
function Pagination({ page, total, size, disabled, onChange }: PaginationProps) {
	return (
		<div className="flex items-center justify-end gap-3 pt-3 text-sm">
			<Button size="sm" variant="secondary" disabled={disabled || page === 0} onClick={() => onChange(page - 1)}>
				<Trans>Previous</Trans>
			</Button>
			<span>{t`Page ${page + 1} of ${Math.ceil(total / size)}`}</span>
			<Button
				size="sm"
				variant="secondary"
				disabled={disabled || (page + 1) * size >= total}
				onClick={() => onChange(page + 1)}
			>
				<Trans>Next</Trans>
			</Button>
		</div>
	);
}
