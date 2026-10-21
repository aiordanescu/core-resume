import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "@lingui/core";
import { strToU8, zipSync } from "fflate";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { buildAccountZip } from "../export";
import { archiveCounts, archiveSettings, readAccountArchive } from "./archive";

beforeAll(() => i18n.loadAndActivate({ locale: "en-US", messages: {} }));

const career = {
	profile: { targetRoles: ["Platform lead"] },
	aiLimits: null,
	facts: [
		{ id: "f1", status: "active" },
		{ id: "f2", status: "forgotten" },
	],
	stories: [],
	artifacts: [],
	schedules: [],
	notifications: [],
	threads: [{ id: "t1" }, { id: "t2", deletedAt: "2026-01-01" }],
	messages: [],
	attachments: [],
	opportunities: [],
	jobs: [],
	transcripts: [],
	workspaces: [],
};

const exportZip = (extra: Record<string, unknown>) =>
	buildAccountZip({
		exportedAt: "2026-10-20T00:00:00.000Z",
		user: { resumePages: 2 },
		resumes: [{ id: "r1", name: "Resume", data: defaultResumeData }],
		coverLetters: [],
		applications: [{ id: "a1" }],
		career: { ...career, ...extra },
		aiContentReports: [],
	} as never);

describe("readAccountArchive", () => {
	it("reads an All That Work export back, and tells it from an upstream one", () => {
		const archive = readAccountArchive(exportZip({ factGroups: [{ group: "x" }], factOverrides: [], review: null }));
		expect(archive.source).toBe("allthatwork");
		expect(archive.exportedAt).toBe("2026-10-20T00:00:00.000Z");
		expect(archive.resumes).toHaveLength(1);
		expect(archiveCounts(archive)).toEqual({
			documents: { resumes: 1, letters: 0 },
			applications: { applications: 1 },
			knowledge: { facts: 1, stories: 0, groups: 1 },
			jobSearch: { opportunities: 0, schedules: 0 },
			coach: { threads: 1 },
		});
		expect(archiveSettings(archive)).toEqual({ preferences: true, aiLimits: false, profile: true });

		expect(readAccountArchive(exportZip({})).source).toBe("reactive-resume");
	});

	it("rejects files that aren't account exports", () => {
		expect(() => readAccountArchive(strToU8("not a zip"))).toThrow("couldn't be read as a zip");
		expect(() => readAccountArchive(zipSync({ "Profile.csv": strToU8("First Name\n") }))).toThrow(
			"isn't an account export",
		);
		expect(() => readAccountArchive(zipSync({ "account.json": strToU8("{"), "career.json": strToU8("{}") }))).toThrow(
			"isn't valid JSON",
		);
	});
});
