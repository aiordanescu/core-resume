import { describe, expect, it, vi } from "vitest";
import { createRouterClient } from "@orpc/server";

const erase = vi.hoisted(() => vi.fn());
vi.mock("./service", () => ({ directoryService: { deleteAllContacts: erase } }));
const { directoryRouter } = await import("./router");

describe("Directory erasure permissions", () => {
	it("requires delete permission even though erasing all contacts uses POST", async () => {
		const client = createRouterClient(directoryRouter, {
			context: {
				locale: "en-US",
				reqHeaders: new Headers(),
				resHeaders: new Headers(),
				authentication: {
					method: "apiKey",
					permissions: ["read", "write"],
					user: {
						id: "owner",
						name: "Owner",
						email: "owner@example.test",
						emailVerified: true,
						createdAt: new Date(),
						updatedAt: new Date(),
					},
				},
			},
		});
		await expect(client.deleteAllContacts({ confirm: true })).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: "This credential requires api:delete permission.",
		});
		expect(erase).not.toHaveBeenCalled();
	});
});
