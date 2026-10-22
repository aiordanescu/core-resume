// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { File as NodeFile } from "node:buffer";
import { webcrypto } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
}));
vi.mock("@/libs/orpc/client", () => {
	const endpoint = (name: "facts" | "groups") => ({
		queryOptions: () => ({ queryKey: [name], queryFn: () => Promise.resolve(api[name]), retry: false }),
		queryKey: () => [name],
	});
	return {
		orpc: { career: { key: () => ["career"], facts: endpoint("facts"), factGroups: endpoint("groups") } },
		client: { career: { importFacts: api.save, updateFact: api.update }, resume: { import: api.resumeImport } },
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

it("stages imported wording as a correction before updating existing Knowledge", async () => {
	api.facts = [known("Engineer at Example, 2020 - 2024, Remote, Platform team")];
	mount();
	upload();
	const importedText = await screen.findByRole("textbox", { name: "Imported fact text" });
	fireEvent.change(importedText, { target: { value: "Engineer at Example, Infrastructure team" } });
	fireEvent.click(screen.getByRole("button", { name: "Use imported wording" }));
	expect(screen.getByRole("textbox", { name: "Existing fact text" })).toHaveValue(
		"Engineer at Example, Infrastructure team",
	);
	expect(api.update).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
	await screen.findByText("Correction saved");
	expect(api.update).toHaveBeenCalledWith({ id: "existing", text: "Engineer at Example, Infrastructure team" });
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
