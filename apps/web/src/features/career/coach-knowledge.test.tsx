// @vitest-environment happy-dom

import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { aiLimitsSchema } from "@reactive-resume/schema/career";

const now = "2026-10-17T00:00:00.000Z";
const fact = (id: string, text: string) => ({
	id,
	text,
	status: "active",
	applicationId: null,
	revisions: [],
	updatedAt: now,
});
const data = vi.hoisted(() => ({
	facts: [] as unknown[],
	stories: [] as unknown[],
	application: { role: "SRE", jobDescription: "Own the Kubernetes platform.", requirements: [] as string[] },
}));

vi.mock("@/libs/orpc/client", () => {
	const options = (key: string, value: () => unknown) => ({ queryKey: [key], queryFn: async () => value() });
	return {
		orpc: {
			career: {
				facts: { queryOptions: () => options("facts", () => data.facts) },
				stories: { queryOptions: () => options("stories", () => data.stories) },
				aiLimits: {
					queryOptions: () => options("limits", () => aiLimitsSchema.parse({ coachFacts: 1, coachStories: 1 })),
				},
			},
			applications: {
				getById: { queryOptions: () => options("application", () => data.application) },
			},
		},
		client: {},
	};
});

const { useCoachKnowledge } = await import("./coach-thread");

const wrapper = ({ children }: { children: ReactNode }) => (
	<QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe("what a coach message shares", () => {
	it("records the facts and stories most relevant to the message and the shared posting", async () => {
		data.facts = [
			fact("newest", "I lead incident reviews."),
			fact("rota", "I run the on-call rota."),
			fact("k8s", "I run Kubernetes clusters."),
		];
		data.stories = [
			{
				id: "s-incident",
				updatedAt: now,
				data: {
					title: "Incident reviews",
					situation: "",
					task: "",
					action: "",
					result: "",
					reflection: "",
					factIds: ["newest"],
					tags: [],
				},
			},
			{
				id: "s-rota",
				updatedAt: now,
				data: {
					title: "Rebuilt the rota",
					situation: "",
					task: "",
					action: "",
					result: "",
					reflection: "",
					factIds: ["rota"],
					tags: [],
				},
			},
		];
		const { result } = renderHook(() => useCoachKnowledge("app"), { wrapper });
		await waitFor(() => expect(result.current.loaded).toBe(true));

		const rota = result.current.sharedFor("How do I explain the on-call rota?", false);
		expect(rota.facts.map((item) => item.id)).toEqual(["rota"]);
		expect(rota.stories.map((item) => item.id)).toEqual(["s-rota"]);

		// No overlap with the message: the shared posting decides.
		const posting = result.current.sharedFor("What should I ask them?", true);
		expect(posting.facts.map((item) => item.id)).toEqual(["k8s"]);
		expect(result.current.sharedFor("What should I ask them?", false).facts.map((item) => item.id)).toEqual(["newest"]);
	});

	it("keeps a story when its fact was switched off and on, and drops it when the fact's text was corrected", async () => {
		const later = "2026-10-18T00:00:00.000Z";
		const story = (id: string, factId: string) => ({
			id,
			updatedAt: now,
			data: { title: id, situation: "", task: "", action: "", result: "", reflection: "", factIds: [factId], tags: [] },
		});
		data.facts = [
			// Corrected before the story was saved, then switched off and on after it: only updatedAt moved.
			{
				...fact("toggled", "I run the on-call rota."),
				revisions: [{ text: "I ran the rota.", at: "2026-10-16T00:00:00.000Z" }],
				updatedAt: later,
			},
			{ ...fact("corrected", "I lead incident reviews."), revisions: [{ text: "I led reviews.", at: later }] },
		];
		data.stories = [story("s-toggled", "toggled"), story("s-corrected", "corrected")];
		const { result } = renderHook(() => useCoachKnowledge(null), { wrapper });
		await waitFor(() => expect(result.current.loaded).toBe(true));

		expect(result.current.stories.map((item) => item.id)).toEqual(["s-toggled"]);
	});
});
