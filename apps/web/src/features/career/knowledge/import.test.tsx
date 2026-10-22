// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { File as NodeFile } from "node:buffer";
import { webcrypto } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

const api = vi.hoisted(() => ({
	facts: [] as { text: string; source: { kind: string; id: string } }[],
	groups: [] as { group: string; status: string | null; private: boolean }[],
	read: vi.fn(),
	detect: vi.fn(),
	save: vi.fn(),
	resumeImport: vi.fn(),
}));
vi.mock("@/libs/orpc/client", () => {
	const endpoint = (name: "facts" | "groups") => ({
		queryOptions: () => ({ queryKey: [name], queryFn: () => Promise.resolve(api[name]), retry: false }),
	});
	return {
		orpc: { career: { key: () => ["career"], facts: endpoint("facts"), factGroups: endpoint("groups") } },
		client: { career: { importFacts: api.save }, resume: { import: api.resumeImport } },
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
	api.facts = [{ text: "PLATFORM ENGINEER!", source: { kind: "manual", id: "existing" } }];
	api.groups = [{ group: "experience", status: "excluded", private: true }];
	mount();
	upload();
	await screen.findAllByRole("textbox", { name: "Fact text" });
	expect(screen.getByText("Already in Knowledge")).toBeInTheDocument();
	expect(screen.getByText("Private")).toBeInTheDocument();
	expect(screen.getAllByRole("checkbox")[0]).toBeDisabled();
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

it("does not parse or save an already imported file again", async () => {
	const bytes = await new NodeFile(["synthetic file"], "LinkedIn.zip").arrayBuffer();
	const digest = Buffer.from(await webcrypto.subtle.digest("SHA-256", bytes)).toString("hex");
	api.facts = [{ text: "Previously imported", source: { kind: "import", id: `import:v1:${digest}:headline/0` } }];
	mount();
	upload();
	await screen.findByText("This file has already been imported. Your existing facts are unchanged.");
	expect(api.read).not.toHaveBeenCalled();
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
