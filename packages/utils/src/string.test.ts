import { describe, expect, it } from "vitest";
import { isRandomSlug, slugify, toUsername } from "./string";

describe("slugify", () => {
	it("falls back to a non-empty slug for CJK input", () => {
		expect(slugify("中文简历")).not.toBe("");
	});
});

describe("toUsername", () => {
	it("removes characters outside [a-z0-9._-]", () => {
		expect(toUsername("  John!@#Doe$%^  ")).toBe("johndoe");
		expect(toUsername("john.doe_test-123")).toBe("john.doe_test-123");
	});

	it("truncates to 64 characters max", () => {
		const longName = "a".repeat(100);
		expect(toUsername(longName)).toHaveLength(64);
	});
});

describe("isRandomSlug", () => {
	it("accepts 12 letters and digits with at least two of each", () => {
		expect(isRandomSlug("k3v9x2m7qa4p")).toBe(true);
	});

	it("rejects addresses made from words, or too short, long or uniform to be random", () => {
		for (const slug of [
			"alexandru-stefan-iordanescu-80",
			"softwaredevs",
			"k3v9x2m7qa4",
			"k3v9x2m7qa4pz",
			"abcdefghijk1",
			"12345678901a",
		])
			expect(isRandomSlug(slug), slug).toBe(false);
	});
});
