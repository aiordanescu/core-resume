import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { careerImportFactsInputSchema } from "@reactive-resume/schema/career";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { resumeToFactCandidates } from "./facts";
import { parseLinkedInExport } from "./linkedin";

const digest = "a".repeat(64);
const resume = () =>
	parseLinkedInExport(
		zipSync({
			"Positions.csv": strToU8(
				'Company Name,Title,Description,Started On,Finished On\nAcme,Lead,Led the team. Built tools.,2021,\nAcme,Engineer,"• Built A\n• Shipped B",2019,2021',
			),
			"Skills.csv": strToU8("Name\nTypeScript\nC++\n"),
			"Education.csv": strToU8("School Name,Degree Name,Activities\n,BSc,Robotics club\n"),
			"Certifications.csv": strToU8(
				"Name,Authority,Started On,Finished On,License Number\nCertified,Example,2020,2024,ID-123\n",
			),
		}),
	);

describe("resumeToFactCandidates", () => {
	it("preserves role attribution, flattened descriptions and parser details without a resume document", () => {
		const facts = resumeToFactCandidates(resume(), digest);
		expect(facts.some((fact) => fact.text === "Lead at Acme: Led the team. Built tools.")).toBe(true);
		expect(facts.filter((fact) => fact.category === "accomplishment").map((fact) => fact.text)).toEqual([
			"Lead at Acme: Led the team. Built tools.",
			"Engineer at Acme: Built A",
			"Engineer at Acme: Shipped B",
		]);
		expect(facts.find((fact) => fact.group === "skills")?.text).toBe("TypeScript; C++");
		expect(facts.find((fact) => fact.group === "education")?.text).toContain("[School name missing]");
		expect(facts.find((fact) => fact.group === "education")?.text).toContain("Robotics club");
		expect(facts.find((fact) => fact.group === "certifications")?.text).toContain(
			"Expires: 2024 License number: ID-123",
		);
		expect(
			facts.filter((fact) => fact.group?.startsWith("experience/")).every((fact) => fact.group === "experience/acme"),
		).toBe(true);
		expect(careerImportFactsInputSchema.safeParse({ facts }).success).toBe(true);
	});

	it("generates the same source identities across repeated parses with fresh resume UUIDs", () => {
		const first = resume();
		const second = resume();
		expect(first.sections.experience.items[0]?.id).not.toBe(second.sections.experience.items[0]?.id);
		expect(resumeToFactCandidates(first, digest)).toEqual(resumeToFactCandidates(second, digest));
		expect(new Set(resumeToFactCandidates(first, digest).map((fact) => fact.source.id)).size).toBe(
			resumeToFactCandidates(first, digest).length,
		);
	});

	it("keeps hidden skills and sections out of the initial selection", () => {
		const data = resume();
		data.sections.experience.hidden = true;
		const skill = data.sections.skills.items[0];
		if (!skill) throw new Error("Missing skill fixture");
		skill.hidden = true;
		const facts = resumeToFactCandidates(data, digest);
		expect(facts.filter((fact) => fact.group === "experience/acme").every((fact) => !fact.selected)).toBe(true);
		expect(facts.find((fact) => fact.group === "skills" && fact.selected)?.text).toBe("C++");
		expect(facts.find((fact) => fact.group === "skills" && !fact.selected)?.text).toBe("TypeScript");
	});

	it("reads rich text, orphan paragraphs, nested lists and entities without executing markup", () => {
		const data = resume();
		const role = data.sections.experience.items[0]?.roles[0];
		if (!role) throw new Error("Missing role fixture");
		role.description =
			"Intro &amp; context<p>First paragraph</p><ul><li>Built &lt;systems&gt;<ul><li>Shipped &#x1F680;</li></ul></li></ul><p>Closing &#99999999;</p><script>ignore()</script>";
		const facts = resumeToFactCandidates(data, digest).filter((fact) => fact.source.id.includes("roles/0/description"));
		expect(facts.map((fact) => fact.source.quote)).toEqual([
			"Intro & context",
			"First paragraph",
			"Built <systems>",
			"Shipped 🚀",
			"Closing &#99999999;",
		]);
		expect(facts.some((fact) => fact.text.includes("ignore()"))).toBe(false);
	});

	it("splits long facts without dropping text, breaking Unicode, or exceeding the cap", () => {
		const data = resume();
		const role = data.sections.experience.items[0]?.roles[0];
		if (!role) throw new Error("Missing role fixture");
		const original = "Built a reliable service 🚀. ".repeat(230).trim();
		role.description = `<p>${original}</p>`;
		const facts = resumeToFactCandidates(data, digest).filter((fact) => fact.source.id.includes("roles/0/description"));
		expect(facts.length).toBeGreaterThan(2);
		expect(facts.every((fact) => fact.text.length <= 2000 && fact.text.isWellFormed())).toBe(true);
		expect(facts.map((fact) => fact.source.quote).join(" ")).toBe(original);
	});

	it("imports summaries and typed custom sections without including contact details", () => {
		const data = structuredClone(defaultResumeData);
		data.basics.email = "private@example.test";
		data.basics.phone = "555-0100";
		data.basics.headline = "Platform engineer";
		data.summary.content = "<p>Builds <strong>reliable</strong> services.</p>";
		data.summary.hidden = false;
		data.customSections.push({
			...data.sections.projects,
			id: "random-uuid",
			type: "projects",
			title: "Community work",
			items: [
				{
					id: "another-uuid",
					hidden: false,
					name: "Public toolkit",
					period: "2024",
					website: { url: "", label: "", inlineLink: false },
					description: "<p>Maintained an open source toolkit.</p>",
				},
			],
		});
		const facts = resumeToFactCandidates(data, digest);
		expect(facts.map((fact) => fact.text)).toEqual([
			"Platform engineer",
			"Builds reliable services.",
			"Public toolkit, 2024: Maintained an open source toolkit.",
		]);
		expect(facts.at(-1)?.group).toBe("custom/community-work");
		expect(facts.some((fact) => fact.text.includes("private@example.test") || fact.text.includes("555-0100"))).toBe(
			false,
		);
	});

	it("keeps custom experience groups and long contextual facts within schema limits", () => {
		const data = resume();
		const item = data.sections.experience.items[0];
		if (!item) throw new Error("Missing experience fixture");
		item.company = "非常に長い会社名".repeat(40);
		data.customSections.push({
			...data.sections.experience,
			id: "custom-random",
			type: "experience",
			title: "Long section ".repeat(30),
			items: [item],
		});
		const facts = resumeToFactCandidates(data, digest);
		expect(careerImportFactsInputSchema.safeParse({ facts }).success).toBe(true);
		expect(facts.every((fact) => fact.text.isWellFormed() && (fact.group?.length ?? 0) <= 200)).toBe(true);
	});
});
