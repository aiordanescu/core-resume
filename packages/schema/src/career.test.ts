import { describe, expect, it } from "vitest";
import { factGroupSchema } from "./career";

describe("fact groups", () => {
	it("trims each level and drops empty ones", () => {
		expect(factGroupSchema.parse(" experience / acme/ ")).toBe("experience/acme");
		expect(factGroupSchema.parse("clearance")).toBe("clearance");
		expect(factGroupSchema.parse("//a///b")).toBe("a/b");
	});

	it("rejects a group with no name", () => {
		expect(factGroupSchema.safeParse(" / ").success).toBe(false);
		expect(factGroupSchema.safeParse("").success).toBe(false);
		expect(factGroupSchema.safeParse("x".repeat(201)).success).toBe(false);
	});
});
