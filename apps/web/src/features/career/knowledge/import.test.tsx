// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { File as NodeFile } from "node:buffer";
import { webcrypto } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { strToU8, zipSync } from "fflate";
import { resumeToFactCandidates } from "@reactive-resume/import/facts";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

const api = vi.hoisted(() => ({
	facts: [] as {
		id: string;
		text: string;
		applicationId: null;
		status: string;
		group: string | null;
		source: { kind: string; id: string };
	}[],
	groups: [] as { group: string; status: string | null; private: boolean }[],
	read: vi.fn(),
	detect: vi.fn(),
	save: vi.fn(),
	update: vi.fn(),
	resumeImport: vi.fn(),
	contacts: [] as {
		id: string;
		name: string;
		updatedAt: Date;
		companyId: string | null;
		profileLinks: string[];
		sources: { kind: string; id: string }[];
	}[],
	companies: [],
	importContacts: vi.fn(),
}));
vi.mock("@/libs/orpc/client", () => {
	const endpoint = (name: "facts" | "groups" | "contacts" | "companies") => ({
		queryOptions: () => ({ queryKey: [name], queryFn: () => Promise.resolve(api[name]), retry: false }),
		queryKey: () => [name],
	});
	return {
		orpc: {
			directory: { key: () => ["directory"], contacts: endpoint("contacts"), companies: endpoint("companies") },
			career: { key: () => ["career"], facts: endpoint("facts"), factGroups: endpoint("groups") },
		},
		client: {
			directory: { importLinkedIn: api.importContacts },
			career: { importFacts: api.save, updateFact: api.update },
			resume: { import: api.resumeImport },
		},
	};
});
vi.mock("@/features/resume/import/read-file", () => ({
	detectImportKind: api.detect,
	readResumeFile: api.read,
	ImportError: class ImportError extends Error {},
}));
vi.mock("@/features/settings/integrations/hooks/use-has-usable-ai-provider", () => ({
	useHasUsableAiProvider: () => ({
		hasUsableProvider: false,
		isUnavailable: false,
		isLoading: false,
		error: null,
		retry: vi.fn(),
	}),
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: ReactNode }) => <a href="#facts">{children}</a>,
}));

import { KnowledgeImportPage } from "./import";

let queryClient: QueryClient;
let resumeData: typeof defaultResumeData;
const known = (text: string, id = "existing") =>
	({ id, text, applicationId: null, status: "active", group: "summary", source: { kind: "manual", id } }) as const;
const mount = () =>
	render(
		<QueryClientProvider client={queryClient}>
			<I18nProvider i18n={i18n}>
				<KnowledgeImportPage />
			</I18nProvider>
		</QueryClientProvider>,
	);
const upload = () =>
	fireEvent.change(screen.getByLabelText("Choose a file to import"), {
		target: { files: [new NodeFile(["synthetic file"], "LinkedIn.zip", { type: "application/zip" })] },
	});

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal("crypto", webcrypto);
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
	api.facts = [];
	api.groups = [];
	api.contacts = [];
	api.companies = [];
	api.importContacts.mockResolvedValue({ created: 1, updated: 0, unchanged: 0, skipped: 0, companiesCreated: 1 });
	const data = structuredClone(defaultResumeData);
	resumeData = data;
	data.basics.headline = "Platform engineer";
	data.summary.content = "<p>Hidden summary detail</p>";
	data.summary.hidden = true;
	data.sections.experience.items = [
		{
			id: "random",
			hidden: false,
			company: "Example",
			position: "Engineer",
			location: "Remote",
			period: "2020 - 2024",
			roles: [],
			website: { url: "", label: "", inlineLink: false },
			description: "<ul><li>Built a toolkit.</li><li>Improved service reliability.</li></ul>",
		},
	];
	api.update.mockImplementation(({ id, text }: { id: string; text: string }) => {
		api.facts = api.facts.map((fact) => (fact.id === id ? { ...fact, text } : fact));
		return Promise.resolve();
	});
	api.detect.mockResolvedValue("linkedin");
	api.read.mockResolvedValue(data);
	api.save.mockImplementation(({ facts }: { facts: { source: { id: string } }[] }) =>
		Promise.resolve({
			results: facts.map((fact, index) => ({ sourceId: fact.source.id, status: "saved", factId: `fact-${index}` })),
		}),
	);
});
afterEach(() => {
	cleanup();
	queryClient.clear();
	vi.unstubAllGlobals();
});

it("reviews before saving, keeps hidden entries unchecked and saves only selected edited text with original evidence", async () => {
	mount();
	upload();
	const texts = await screen.findAllByRole("textbox", { name: "Fact text" });
	expect(api.save).not.toHaveBeenCalled();
	const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
	expect(checkboxes.map((checkbox) => checkbox.checked)).toEqual([true, false, true, true, true]);
	fireEvent.change(texts[3] as HTMLElement, {
		target: { value: "Engineer at Example: Built and maintained a toolkit." },
	});
	fireEvent.click(checkboxes[4] as HTMLElement);
	fireEvent.click(screen.getByRole("button", { name: "Save 3 facts" }));
	await screen.findByText("Knowledge import complete");
	expect(api.save).toHaveBeenCalledOnce();
	const payload = api.save.mock.calls[0]?.[0];
	expect(payload.facts).toHaveLength(3);
	expect(payload.facts[2]).toMatchObject({
		text: "Engineer at Example: Built and maintained a toolkit.",
		source: { kind: "import", quote: "Built a toolkit." },
	});
	expect(api.resumeImport).not.toHaveBeenCalled();
});

it("marks normalized duplicates and displays private/excluded group settings", async () => {
	api.facts = [known("PLATFORM ENGINEER!")];
	api.groups = [{ group: "experience", status: "excluded", private: true }];
	mount();
	upload();
	await screen.findAllByRole("textbox", { name: "Fact text" });
	expect(screen.getByRole("region", { name: /Duplicates/ })).toBeInTheDocument();
	expect(screen.getByText("Same text")).toBeInTheDocument();
	expect(screen.getByText("Private")).toBeInTheDocument();
	expect(within(screen.getByRole("region", { name: /Duplicates/ })).queryByRole("checkbox")).toBeNull();
	expect(screen.getByRole("button", { name: "Save 3 facts" })).toBeEnabled();
});

it("keeps the review and edits after a failed save, then retries with the same source identity", async () => {
	api.save.mockRejectedValueOnce(new Error("Offline"));
	mount();
	upload();
	const texts = await screen.findAllByRole("textbox", { name: "Fact text" });
	fireEvent.change(texts[0] as HTMLElement, { target: { value: "Senior platform engineer" } });
	fireEvent.click(screen.getByRole("button", { name: "Save 4 facts" }));
	await screen.findByRole("alert");
	expect(screen.getByDisplayValue("Senior platform engineer")).toBeInTheDocument();
	fireEvent.click(screen.getByRole("button", { name: "Save 4 facts" }));
	await screen.findByText("Knowledge import complete");
	expect(api.save.mock.calls[1]?.[0]).toEqual(api.save.mock.calls[0]?.[0]);
});

it("reopens an already imported file for comparison and can finish without saving any copies", async () => {
	const bytes = await new NodeFile(["synthetic file"], "LinkedIn.zip").arrayBuffer();
	const digest = Buffer.from(await webcrypto.subtle.digest("SHA-256", bytes)).toString("hex");
	api.facts = resumeToFactCandidates(resumeData, digest).map((fact, index) => ({
		...known(fact.text, `saved-${index}`),
		source: fact.source,
	}));
	mount();
	upload();
	await screen.findAllByText("Imported before");
	expect(api.read).toHaveBeenCalledOnce();
	expect(screen.getByRole("region", { name: /New facts/ })).toHaveTextContent("All proposed facts have matches");
	fireEvent.click(screen.getByRole("button", { name: "Finish review" }));
	await screen.findByText("Knowledge import complete");
	expect(api.save).not.toHaveBeenCalled();
});

it("leaves near duplicates out until Keep both is chosen, keeping comparisons in place during edits", async () => {
	api.facts = [known("Engineer at Example, 2020 - 2024, Remote, Platform team")];
	mount();
	upload();
	const importedText = await screen.findByRole("textbox", { name: "Imported fact text" });
	expect(screen.getByText("Possible duplicate")).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Save 3 facts" })).toBeEnabled();
	importedText.focus();
	fireEvent.change(importedText, {
		target: { value: "Engineer at Example, 2020 - 2024, Remote, Infrastructure team" },
	});
	expect(document.activeElement).toBe(importedText);
	fireEvent.click(screen.getByRole("button", { name: "Keep both" }));
	fireEvent.click(screen.getByRole("button", { name: "Save 4 facts" }));
	await screen.findByText("Knowledge import complete");
	expect(api.save.mock.calls[0]?.[0].facts).toContainEqual(
		expect.objectContaining({ text: "Engineer at Example, 2020 - 2024, Remote, Infrastructure team" }),
	);
});

it("only corrects existing Knowledge on explicit Save correction and keeps import evidence separate", async () => {
	api.facts = [known("PLATFORM ENGINEER!")];
	mount();
	upload();
	fireEvent.click(await screen.findByRole("button", { name: "Edit existing fact" }));
	fireEvent.change(screen.getByRole("textbox", { name: "Existing fact text" }), {
		target: { value: "Senior platform engineer" },
	});
	expect(api.update).not.toHaveBeenCalled();
	expect(screen.getByRole("button", { name: "Save 3 facts" })).toBeDisabled();
	fireEvent.click(screen.getByRole("button", { name: "Cancel correction" }));
	expect(api.update).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Edit existing fact" }));
	fireEvent.change(screen.getByRole("textbox", { name: "Existing fact text" }), {
		target: { value: "Senior platform engineer" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
	await screen.findByText("Correction saved");
	expect(api.update).toHaveBeenCalledWith({ id: "existing", text: "Senior platform engineer" });
	expect(api.save).not.toHaveBeenCalled();
	expect(screen.getByRole("textbox", { name: "Imported fact text" })).toHaveValue("Platform engineer");
});

it("retains a failed correction for retry and stops when the existing fact changed elsewhere", async () => {
	api.facts = [known("PLATFORM ENGINEER!")];
	api.update.mockRejectedValueOnce(new Error("Offline"));
	mount();
	upload();
	fireEvent.click(await screen.findByRole("button", { name: "Edit existing fact" }));
	fireEvent.change(screen.getByRole("textbox", { name: "Existing fact text" }), {
		target: { value: "Senior platform engineer" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
	await screen.findByRole("alert");
	expect(screen.getByRole("textbox", { name: "Existing fact text" })).toHaveValue("Senior platform engineer");
	api.facts = [known("Updated in another window")];
	fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
	await screen.findByText(
		"This fact changed while you were editing. Cancel this correction and check the latest text.",
	);
	expect(api.update).toHaveBeenCalledOnce();
});

it("copies only the named imported fact into a correction when the comparison contains another file fact", async () => {
	api.facts = [known("Engineer at Second Example, 2020 - 2024, Remote")];
	const first = resumeData.sections.experience.items[0];
	if (!first) throw new Error("Missing experience fixture");
	first.description = "";
	resumeData.sections.experience.items.push({ ...first, id: "second-role", company: "Second Example" });
	mount();
	upload();
	const heading = await screen.findByRole("heading", { name: "Second Example" });
	const comparison = within(heading.closest("article") as HTMLElement);
	const fileFacts = comparison.getByRole("region", { name: "From this file" });
	const storedFacts = comparison.getByRole("region", { name: "In Knowledge" });
	fireEvent.change(within(fileFacts).getByRole("textbox", { name: "Imported fact text" }), {
		target: { value: "Engineer at Second Example, Infrastructure team" },
	});
	fireEvent.change(within(fileFacts).getByRole("textbox", { name: "Other imported fact text" }), {
		target: { value: "Engineer at Example, Platform team" },
	});
	fireEvent.click(within(storedFacts).getByRole("button", { name: "Use wording from Second Example" }));
	expect(comparison.getByRole("textbox", { name: "Existing fact text" })).toHaveValue(
		"Engineer at Second Example, Infrastructure team",
	);
	expect(api.update).not.toHaveBeenCalled();
	expect(api.save).not.toHaveBeenCalled();
	fireEvent.click(comparison.getByRole("button", { name: "Save correction" }));
	await comparison.findByText("Correction saved");
	expect(api.update).toHaveBeenCalledExactlyOnceWith({
		id: "existing",
		text: "Engineer at Second Example, Infrastructure team",
	});
	expect(within(fileFacts).getByRole("textbox", { name: "Other imported fact text" })).toHaveValue(
		"Engineer at Example, Platform team",
	);
	expect(api.save).not.toHaveBeenCalled();
});

it("rechecks current Knowledge without losing edits or silently selecting new matches", async () => {
	mount();
	upload();
	const texts = await screen.findAllByRole("textbox", { name: "Fact text" });
	fireEvent.change(texts[3] as HTMLElement, { target: { value: "Engineer at Example: Maintained a toolkit." } });
	api.facts = [known("Platform engineer")];
	fireEvent.click(screen.getByRole("button", { name: "Recheck matches" }));
	await screen.findByText("Same text");
	expect(screen.getByDisplayValue("Engineer at Example: Maintained a toolkit.")).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Save 3 facts" })).toBeEnabled();
	expect(api.save).not.toHaveBeenCalled();
});

it("cancels an in-flight read without showing its late result", async () => {
	let resolveRead: ((value: typeof defaultResumeData) => void) | undefined;
	api.read.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				resolveRead = resolve;
			}),
	);
	mount();
	upload();
	await waitFor(() => expect(api.read).toHaveBeenCalled());
	fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
	resolveRead?.(structuredClone(defaultResumeData));
	await waitFor(() => expect(screen.getByRole("button", { name: "Choose a file" })).toBeInTheDocument());
	expect(screen.queryByRole("textbox", { name: "Fact text" })).toBeNull();
});

const uploadArchive = () =>
	fireEvent.change(screen.getByLabelText("Choose a file to import"), {
		target: {
			files: [
				new NodeFile(
					[
						zipSync({
							"Profile.csv": strToU8("profile"),
							"Connections.csv": strToU8(
								"First Name,Last Name,URL,Email Address,Company,Position,Connected On\nCasey,Nguyen,https://linkedin.com/in/casey,casey@example.test,Lumen,Engineer,13 Aug 2026",
							),
						}),
					],
					"LinkedIn.zip",
					{ type: "application/zip" },
				),
			],
		},
	});

it("uses one archive for facts and optional contacts, leaving contact import off by default", async () => {
	mount();
	uploadArchive();
	const contacts = await screen.findByRole("checkbox", { name: "Import contacts from this export" });
	expect(contacts).not.toBeChecked();
	expect(screen.queryByRole("checkbox", { name: "Also import email addresses" })).not.toBeInTheDocument();
	fireEvent.click(screen.getByRole("button", { name: "Save 4 facts" }));
	await screen.findByText("Knowledge import complete");
	expect(api.save).toHaveBeenCalledOnce();
	expect(api.importContacts).not.toHaveBeenCalled();
	expect(api.read.mock.calls[0]?.[2].bytes).toBeInstanceOf(Uint8Array);
});
it("reviews contacts from the same file and includes available emails with selected contacts", async () => {
	mount();
	uploadArchive();
	fireEvent.click(await screen.findByRole("checkbox", { name: "Import contacts from this export" }));
	await screen.findByText("1 contact selected");
	expect(screen.queryByRole("checkbox", { name: "Also import email addresses" })).not.toBeInTheDocument();
	expect(screen.getByRole("checkbox", { name: "Import Casey Nguyen" })).toBeChecked();
	expect(screen.queryByRole("combobox", { name: "Import action for Casey Nguyen" })).not.toBeInTheDocument();
	expect(api.importContacts).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Import selected facts and contacts" }));
	await screen.findByText("Knowledge import complete");
	expect(api.save).toHaveBeenCalledOnce();
	expect(api.importContacts).toHaveBeenCalledWith(
		expect.objectContaining({
			importEmails: true,
			rows: [
				expect.objectContaining({
					action: "create",
					connection: expect.objectContaining({ email: "casey@example.test", name: "Casey Nguyen" }),
				}),
			],
		}),
	);
	expect(screen.getByRole("link", { name: "View contacts" })).toBeInTheDocument();
});
it("supports a connections-only archive and includes available email", async () => {
	api.read.mockRejectedValue(new Error("No profile"));
	mount();
	uploadArchive();
	fireEvent.click(await screen.findByRole("checkbox", { name: "Import contacts from this export" }));
	await screen.findByText("1 contact selected");
	fireEvent.click(screen.getByRole("button", { name: "Import selected facts and contacts" }));
	await screen.findByText("Knowledge import complete");
	expect(api.save).not.toHaveBeenCalled();
	expect(api.importContacts.mock.calls[0]?.[0].rows[0].connection.email).toBe("casey@example.test");
});
it("keeps saved facts after a contact failure and allows retry without resubmitting facts", async () => {
	api.importContacts.mockRejectedValueOnce(new Error("Network interrupted"));
	mount();
	uploadArchive();
	fireEvent.click(await screen.findByRole("checkbox", { name: "Import contacts from this export" }));
	await screen.findByText("1 contact selected");
	fireEvent.click(screen.getByRole("button", { name: "Import selected facts and contacts" }));
	await waitFor(() => expect(screen.getByRole("button", { name: "Import selected facts and contacts" })).toBeEnabled());
	expect(api.save).toHaveBeenCalledOnce();
	fireEvent.click(screen.getByRole("button", { name: "Import selected facts and contacts" }));
	await screen.findByText("Knowledge import complete");
	expect(api.save).toHaveBeenCalledOnce();
	expect(api.importContacts).toHaveBeenCalledTimes(2);
});

it("uses checkboxes to exclude and restore a contact while retaining its email", async () => {
	mount();
	uploadArchive();
	fireEvent.click(await screen.findByRole("checkbox", { name: "Import contacts from this export" }));
	const checkbox = await screen.findByRole("checkbox", { name: "Import Casey Nguyen" });
	fireEvent.click(checkbox);
	await screen.findByText("0 contacts selected");
	fireEvent.click(checkbox);
	await screen.findByText("1 contact selected");
	fireEvent.click(screen.getByRole("button", { name: "Import selected facts and contacts" }));
	await screen.findByText("Knowledge import complete");
	expect(api.importContacts.mock.calls[0]?.[0].rows[0].connection.email).toBe("casey@example.test");
});
it("requires a deliberate match for possible duplicates and remembers it across checkbox changes", async () => {
	api.contacts = [
		{
			id: "existing-casey",
			name: "Casey Nguyen",
			updatedAt: new Date("2026-10-23T18:00:00Z"),
			companyId: null,
			profileLinks: [],
			sources: [],
		},
	];
	mount();
	uploadArchive();
	fireEvent.click(await screen.findByRole("checkbox", { name: "Import contacts from this export" }));
	const checkbox = await screen.findByRole("checkbox", { name: "Import Casey Nguyen" });
	expect(checkbox).not.toBeChecked();
	fireEvent.click(checkbox);
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "Import selected facts and contacts" })).toBeDisabled(),
	);
	fireEvent.click(screen.getByRole("radio", { name: "Update Casey Nguyen" }));
	await screen.findByText("1 contact selected");
	fireEvent.click(checkbox);
	fireEvent.click(checkbox);
	expect(screen.getByRole("radio", { name: "Update Casey Nguyen" })).toBeChecked();
	fireEvent.click(screen.getByRole("button", { name: "Import selected facts and contacts" }));
	await screen.findByText("Knowledge import complete");
	expect(api.importContacts.mock.calls[0]?.[0].rows[0]).toMatchObject({
		action: "update",
		contactId: "existing-casey",
		duplicateDecision: "merge",
	});
});
