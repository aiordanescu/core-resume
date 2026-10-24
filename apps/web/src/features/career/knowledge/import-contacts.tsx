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

/** The source file and excluded emails never enter a request. A retried batch cannot create URL duplicates. */
export async function saveReviewedContacts(
	selection: ContactsImportSelection,
	onProgress: (result: ContactsImportResult, completed: string[]) => void,
) {
	const total = emptyContactsResult();
	for (let start = 0; start < selection.rows.length; start += 500) {
		const rows = selection.rows.slice(start, start + 500).map((row) => ({
			...row,
			connection: { ...row.connection, email: selection.importEmails ? row.connection.email : "" },
		}));
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
	const [importEmails, setImportEmails] = useState(false);
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
				const action =
					choices[connection.profileUrl] ??
					(match.kind === "update" ? (match.contact?.id ?? "skip") : match.kind === "duplicate" ? "skip" : "create");
				return { connection, match, action };
			}),
		[file, contactIndex, choices],
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
			mappings.some((mapping) => !mapping.choice.name.trim())
				? null
				: { rows: selected, companies: mappings.map((mapping) => mapping.choice), importEmails },
		[selected, mappings, importEmails, contacts.isPending, contacts.isError, companies.isPending, companies.isError],
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
			<label className="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					checked={importEmails}
					disabled={disabled}
					onChange={(event) => setImportEmails(event.target.checked)}
				/>
				<Trans>Also import email addresses</Trans>
			</label>
			<p className="text-xs text-ink-3">
				<Trans>Email addresses stay in your browser unless you select this option.</Trans>
			</p>
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
				<Button variant="ghost" size="sm" disabled={disabled} onClick={() => setChoices({})}>
					<Trans>Select new and matched contacts</Trans>
				</Button>
				<Button
					variant="ghost"
					size="sm"
					disabled={disabled}
					onClick={() => setChoices(Object.fromEntries(rows.map((row) => [row.connection.profileUrl, "skip"])))}
				>
					<Trans>Skip all contacts</Trans>
				</Button>
			</div>
			<div className="overflow-x-auto">
				<table className="w-full text-start text-sm">
					<thead>
						<tr className="border-b border-line">
							<th className="p-2 text-start">
								<Trans>Contact from file</Trans>
							</th>
							<th className="p-2 text-start">
								<Trans>Import action</Trans>
							</th>
							{importEmails && (
								<th className="p-2 text-start">
									<Trans>Email address</Trans>
								</th>
							)}
						</tr>
					</thead>
					<tbody>
						{visible.slice(page * 50, (page + 1) * 50).map(({ connection, match, action }) => (
							<tr key={connection.profileUrl} className="border-b border-line align-top">
								<td className="grid gap-1 p-2">
									<span className="font-medium">{connection.name}</span>
									<span className="text-xs text-ink-2">
										{[connection.position, connection.company].filter(Boolean).join(" · ")}
									</span>
									<a
										href={connection.profileUrl}
										target="_blank"
										rel="noreferrer"
										className="text-xs text-accent-text hover:underline"
									>
										<Trans>Open LinkedIn profile</Trans>
									</a>
									{match.contact && <span className="text-xs text-ink-3">{t`Existing: ${match.contact.name}`}</span>}
									{connection.connectedOn && (
										<span className="text-xs text-ink-3">{t`Connected: ${connection.connectedOn}`}</span>
									)}
								</td>
								<td className="p-2">
									<select
										aria-label={t`Import action for ${connection.name}`}
										className="max-w-72 rounded-md border border-line bg-surface p-2"
										disabled={disabled}
										value={action}
										onChange={(event) =>
											setChoices((previous) => ({ ...previous, [connection.profileUrl]: event.target.value }))
										}
									>
										<option value="skip">{t`Skip`}</option>
										{match.identities.length === 0 && (
											<option value="create">
												{match.kind === "duplicate" ? t`Create separate contact` : t`Create contact`}
											</option>
										)}
										{match.candidates.map((candidate) => (
											<option key={candidate.id} value={candidate.id}>
												{t`Update ${candidate.name}`}
												{"companyId" in candidate && typeof candidate.companyId === "string"
													? ` · ${names.get(candidate.companyId) ?? ""}`
													: ""}
											</option>
										))}
									</select>
								</td>
								{importEmails && <td className="p-2">{connection.email || "—"}</td>}
							</tr>
						))}
					</tbody>
				</table>
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
