import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { LinkedInConnectionsError, parseLinkedInConnectionsCsv, readLinkedInConnections } from "./linkedin-connections";

const header = "First Name,Last Name,URL,Email Address,Company,Position,Connected On";
const row =
	'Casey,Nguyen,https://www.linkedin.com/in/casey?trk=export,casey@example.test,"Lumen, Inc.",Engineer,13 Aug 2026';
describe("LinkedIn connections", () => {
	it("reads the Notes preamble, BOM, quoted fields, escaped quotes, and multiline cells", () => {
		const data = parseLinkedInConnectionsCsv(
			'\uFEFFNotes:\r\nYour connections may have "hidden emails\r\n\r\n' +
				header +
				"\r\n" +
				row +
				'\r\nJo,Example,https://linkedin.com/in/jo,,Example,"Staff ""Platform""\nEngineer",2026-10-23',
		);
		expect(data.connections).toEqual([
			{
				name: "Casey Nguyen",
				profileUrl: "https://www.linkedin.com/in/casey",
				email: "casey@example.test",
				company: "Lumen, Inc.",
				position: "Engineer",
				connectedOn: "2026-08-13",
			},
			{
				name: "Jo Example",
				profileUrl: "https://www.linkedin.com/in/jo",
				email: "",
				company: "Example",
				position: 'Staff "Platform"\nEngineer',
				connectedOn: "2026-10-23",
			},
		]);
	});
	it("skips unavailable identities, removes URL duplicates, and reports invalid optional fields", () => {
		const result = parseLinkedInConnectionsCsv(
			[
				header,
				row,
				"Other,Name,http://uk.linkedin.com/in/CASEY/,,,Lead,",
				",,https://linkedin.com/in/deleted,,,,",
				"No,URL,,,,,",
				"New,Person,https://linkedin.com/in/new,invalid,Example,Lead,31 Feb 2026",
			].join("\n"),
		);
		expect(result).toMatchObject({ skipped: 2, duplicateRows: 1, invalidEmails: 1, invalidDates: 1 });
		expect(result.connections[1]).toMatchObject({ email: "", connectedOn: null });
	});
	it("reads nested Connections.csv from one full export and ignores messages", () => {
		const bytes = zipSync({
			"export/Connections.csv": strToU8(header + "\n" + row),
			"messages.csv": new Uint8Array([255]),
			"__MACOSX/Connections.csv": new Uint8Array([255]),
		});
		expect(readLinkedInConnections(bytes, "export.zip").connections).toHaveLength(1);
	});
	it("distinguishes archives without connections and rejects ambiguous or malformed files", () => {
		try {
			readLinkedInConnections(zipSync({ "Profile.csv": strToU8("profile") }), "export.zip");
		} catch (error) {
			expect(error).toBeInstanceOf(LinkedInConnectionsError);
			expect(error).toMatchObject({ code: "not-found" });
		}
		expect(() =>
			readLinkedInConnections(
				zipSync({ "a/Connections.csv": strToU8(header), "b/Connections.csv": strToU8(header) }),
				"export.zip",
			),
		).toThrow(/multiple/);
		expect(() => parseLinkedInConnectionsCsv(header + '\nCasey,Nguyen,"unfinished')).toThrow(/unfinished/);
		expect(() => readLinkedInConnections(new Uint8Array([255]), "Connections.csv")).toThrow(/UTF-8/);
		expect(() => parseLinkedInConnectionsCsv("unrelated,data")).toThrow(/Connections.csv/);
	});
});
