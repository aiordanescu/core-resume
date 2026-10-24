import type { LinkedInConnection } from "@reactive-resume/schema/directory-import";
import { unzipSync } from "fflate";
import { linkedInConnectionSchema, linkedInProfileKey } from "@reactive-resume/schema/directory-import";

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_CSV_BYTES = 20 * 1024 * 1024;
const MAX_CONNECTIONS = 30_000;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export class LinkedInConnectionsError extends Error {
	constructor(
		message: string,
		readonly code: "not-found" | "invalid" = "invalid",
	) {
		super(message);
	}
}
export type LinkedInConnectionsFile = {
	connections: LinkedInConnection[];
	skipped: number;
	duplicateRows: number;
	invalidEmails: number;
	invalidDates: number;
};

function csvRows(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (char === '"') {
			if (quoted && text[i + 1] === '"') {
				field += '"';
				i++;
			} else if (quoted || field.length === 0) quoted = !quoted;
			else field += char;
		} else if (!quoted && char === ",") {
			row.push(field);
			field = "";
		} else if (!quoted && (char === "\r" || char === "\n")) {
			if (char === "\r" && text[i + 1] === "\n") i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
		} else field += char;
	}
	if (quoted) throw new LinkedInConnectionsError("Connections.csv contains an unfinished quoted field.");
	if (row.length || field) {
		row.push(field);
		rows.push(row);
	}
	return rows.filter((cells) => cells.some((cell) => cell.trim()));
}

function connectedDate(value: string): string | null {
	if (!value) return null;
	const match = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/.exec(value);
	const month = MONTHS.indexOf(match?.[2]?.toLowerCase() ?? "");
	const iso =
		match && month >= 0
			? `${match[3]}-${String(month + 1).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}`
			: value;
	const parsed = linkedInConnectionSchema.shape.connectedOn.safeParse(iso);
	return parsed.success ? parsed.data : null;
}

export function parseLinkedInConnectionsCsv(text: string): LinkedInConnectionsFile {
	if (new TextEncoder().encode(text).length > MAX_CSV_BYTES)
		throw new LinkedInConnectionsError("Connections.csv is too large (maximum 20 MB).");
	// Ignore LinkedIn's Notes preamble, even when it contains unmatched prose quotation marks.
	const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
	const headerAt = lines.findIndex(
		(line) => /First Name/.test(line) && /Last Name/.test(line) && /(?:^|,)\s*"?URL"?\s*(?:,|$)/.test(line),
	);
	if (headerAt < 0) throw new LinkedInConnectionsError("Choose Connections.csv from your LinkedIn data export.");
	const rows = csvRows(lines.slice(headerAt).join("\n"));
	const header = rows.shift()?.map((cell) => cell.trim()) ?? [];
	const column = (name: string) => header.indexOf(name);
	if (["First Name", "Last Name", "URL"].some((name) => column(name) < 0))
		throw new LinkedInConnectionsError("Connections.csv is missing its name or URL columns.");
	if (rows.length > MAX_CONNECTIONS) throw new LinkedInConnectionsError("Import at most 30,000 connections at a time.");
	const result: LinkedInConnectionsFile = {
		connections: [],
		skipped: 0,
		duplicateRows: 0,
		invalidEmails: 0,
		invalidDates: 0,
	};
	const seen = new Set<string>();
	for (const cells of rows) {
		const cell = (name: string) => (cells[column(name)] ?? "").trim();
		const name = [cell("First Name"), cell("Last Name")].filter(Boolean).join(" ");
		const profileUrl = linkedInProfileKey(cell("URL"));
		if (!name || !profileUrl) {
			result.skipped++;
			continue;
		}
		if (seen.has(profileUrl)) {
			result.duplicateRows++;
			continue;
		}
		let email = cell("Email Address");
		if (!linkedInConnectionSchema.shape.email.safeParse(email).success) {
			email = "";
			result.invalidEmails++;
		}
		const connectedOn = connectedDate(cell("Connected On"));
		if (cell("Connected On") && !connectedOn) result.invalidDates++;
		const parsed = linkedInConnectionSchema.safeParse({
			name,
			profileUrl,
			company: cell("Company"),
			position: cell("Position"),
			email,
			connectedOn,
		});
		if (!parsed.success) {
			result.skipped++;
			continue;
		}
		seen.add(profileUrl);
		result.connections.push(parsed.data);
	}
	return result;
}

/** Open only Connections.csv in an archive. Other LinkedIn files never leave the browser or get decompressed. */
export function readLinkedInConnections(bytes: Uint8Array, fileName: string): LinkedInConnectionsFile {
	if (bytes.length > MAX_FILE_BYTES) throw new LinkedInConnectionsError("Choose a file smaller than 100 MB.");
	const zipped = /\.zip$/i.test(fileName) || (bytes[0] === 0x50 && bytes[1] === 0x4b);
	let csv = bytes;
	if (zipped) {
		let count = 0;
		let tooLarge = false;
		let matches = 0;
		let files: Record<string, Uint8Array>;
		try {
			files = unzipSync(bytes, {
				filter: (file) => {
					count++;
					if (count > 30_000) {
						tooLarge = true;
						return false;
					}
					if (file.name.startsWith("__MACOSX/") || file.name.split("/").at(-1)?.toLowerCase() !== "connections.csv")
						return false;
					matches++;
					if (file.originalSize > MAX_CSV_BYTES || matches > 1) {
						tooLarge = true;
						return false;
					}
					return true;
				},
			});
		} catch {
			throw new LinkedInConnectionsError("This zip could not be read. Choose the LinkedIn export or Connections.csv.");
		}
		if (tooLarge)
			throw new LinkedInConnectionsError(
				"This archive has too many entries, multiple Connections.csv files, or a Connections.csv larger than 20 MB.",
			);
		const entry = Object.values(files)[0];
		if (!entry)
			throw new LinkedInConnectionsError(
				"This zip has no Connections.csv. Request a LinkedIn export with Connections selected.",
				"not-found",
			);
		csv = entry;
	}
	try {
		return parseLinkedInConnectionsCsv(new TextDecoder("utf-8", { fatal: true }).decode(csv));
	} catch (error) {
		if (error instanceof LinkedInConnectionsError) throw error;
		throw new LinkedInConnectionsError("Connections.csv is not valid UTF-8 text.");
	}
}
