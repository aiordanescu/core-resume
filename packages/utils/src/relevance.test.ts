import { describe, expect, it } from "vitest";
import { coachQuery, rankByRelevance, relevanceScores, stem, storyText, terms } from "./relevance";

const facts = [
	{ id: "newest", text: "Organised the quarterly offsite and the planning calendar." },
	{ id: "otel", text: "Architected the OpenTelemetry ingestion pipeline for 400+ applications." },
	{ id: "k8s", text: "Migrated AppDynamics monitoring to Kubernetes clusters on Amazon EKS." },
	{ id: "team", text: "Hired and coached the team of five engineers." },
	{ id: "oldest", text: "Led weekly status meetings with the client team." },
];
const ids = (items: Array<{ id: string }>) => items.map((item) => item.id);

describe("relevance", () => {
	it("stems word forms to the same term and leaves technical tokens whole", () => {
		expect(new Set(["migrated", "migrating", "migration", "migrations", "migrate"].map(stem)).size).toBe(1);
		expect(new Set(["deployments", "deployed", "deploying"].map(stem)).size).toBe(1);
		expect(stem("business")).toBe("business");
		expect(terms("Led C#, C++ and Node.js work on K8s at a café")).toEqual([
			"led",
			"c#",
			"c++",
			"node.js",
			"k8s",
			"cafe",
		]);
	});

	it("ranks facts that share the posting's distinctive terms first and keeps the rest in their order", () => {
		const posting = "You will run OpenTelemetry collectors and lead Kubernetes migrations.";
		expect(ids(rankByRelevance(facts, (fact) => fact.text, posting))).toEqual([
			"k8s",
			"otel",
			"newest",
			"team",
			"oldest",
		]);
	});

	it("weights rare terms above common ones", () => {
		const common = [
			{ id: "a", text: "Platform work with the team." },
			{ id: "b", text: "Platform migration with the team." },
			{ id: "c", text: "Platform reviews with the team and Terraform." },
		];
		const [first] = rankByRelevance(common, (item) => item.text, "platform team terraform");
		expect(first?.id).toBe("c");
	});

	it("doesn't let a long fact win on length alone", () => {
		const items = [
			{ id: "long", text: `Grafana dashboards. ${"Unrelated words about many other things. ".repeat(40)}` },
			{ id: "short", text: "Built Grafana dashboards." },
		];
		expect(ids(rankByRelevance(items, (item) => item.text, "grafana dashboards"))).toEqual(["short", "long"]);
	});

	it("leaves the order alone for an empty query or one of only stopwords, and scores no-overlap as 0", () => {
		expect(ids(rankByRelevance(facts, (fact) => fact.text, ""))).toEqual(ids(facts));
		expect(ids(rankByRelevance(facts, (fact) => fact.text, "the and with years of experience"))).toEqual(ids(facts));
		expect(relevanceScores(facts, (fact) => fact.text, "Salesforce")).toEqual([0, 0, 0, 0, 0]);
	});

	it("builds the coach query from the message and, when shared, the posting", () => {
		const application = { role: "SRE", jobDescription: "Kubernetes on-call", requirements: ["Terraform"] };
		expect(coachQuery("How do I answer?", application)).toBe("How do I answer?\nSRE\nKubernetes on-call\nTerraform");
		expect(coachQuery("How do I answer?", null)).toBe("How do I answer?");
		expect(
			storyText({ title: "T", situation: "S", task: "K", action: "A", result: "R", reflection: "", tags: ["x"] }),
		).toBe("T\nS\nK\nA\nR\n\nx");
	});
});
