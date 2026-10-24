import { describe, expect, it } from "vitest";
import {
	hasLinkedInProfile,
	indexLinkedInContacts,
	linkedInConnectionSchema,
	linkedInProfileKey,
	matchLinkedInCompany,
	matchLinkedInContact,
	updateLinkedInContactIndex,
} from "./directory-import";
const person = { id: "one", name: "Casey Nguyen", profileLinks: ["https://linkedin.com/in/Casey/?trk=x"], sources: [] };
const connection = linkedInConnectionSchema.parse({
	name: "Casey Nguyen",
	profileUrl: "https://uk.linkedin.com/in/CASEY",
});
describe("LinkedIn matching", () => {
	it("canonicalizes profile identity without accepting unrelated hosts, credentials, or paths", () => {
		expect(connection.profileUrl).toBe("https://www.linkedin.com/in/casey");
		for (const value of [
			"https://linkedin.com.evil.test/in/a",
			"https://user:pass@linkedin.com/in/a",
			"https://linkedin.com/company/a",
			"https://linkedin.com/in/a%2fb",
			"javascript:alert(1)",
		])
			expect(linkedInProfileKey(value)).toBeNull();
	});
	it("matches by profile even after a name change; name matches need a decision", () => {
		expect(matchLinkedInContact({ ...connection, name: "Changed Name" }, [person])).toMatchObject({
			kind: "update",
			contact: person,
		});
		expect(
			matchLinkedInContact({ ...connection, profileUrl: "https://www.linkedin.com/in/other" }, [person]),
		).toMatchObject({ kind: "duplicate", contact: null });
		expect(matchLinkedInContact(connection, [person, { ...person, id: "two" }])).toMatchObject({
			kind: "duplicate",
			contact: null,
		});
	});
	it("tells contacts identified by a LinkedIn profile from hand-made ones", () => {
		expect(hasLinkedInProfile(person)).toBe(true);
		expect(
			hasLinkedInProfile({ ...person, profileLinks: [], sources: [{ kind: "linkedin", id: connection.profileUrl }] }),
		).toBe(true);
		expect(hasLinkedInProfile({ ...person, profileLinks: ["https://example.com/casey"], sources: [] })).toBe(false);
	});
	it("maintains identity indexes across updates and imports", () => {
		const index = indexLinkedInContacts([person]);
		const updated = {
			...person,
			name: "Changed Name",
			profileLinks: [],
			sources: [{ kind: "linkedin", id: connection.profileUrl }],
		};
		updateLinkedInContactIndex(index, updated, person);
		expect(matchLinkedInContact(connection, index)).toMatchObject({ kind: "update", contact: updated });
		expect(matchLinkedInContact({ ...connection, profileUrl: "https://www.linkedin.com/in/new" }, index).kind).toBe(
			"new",
		);
	});
	it("suggests company variants without merging them automatically and remembers reviewed aliases", () => {
		const company = { id: "company", name: "Lumen", sources: [] };
		expect(matchLinkedInCompany("Lumen, Inc.", [company])).toEqual({ exact: null, suggestions: [company] });
		expect(matchLinkedInCompany("LUMEN", [company]).exact).toEqual(company);
		expect(
			matchLinkedInCompany("Lumen, Inc.", [{ ...company, sources: [{ kind: "linkedin", id: "Lumen, Inc." }] }]).exact
				?.id,
		).toBe("company");
	});
});
