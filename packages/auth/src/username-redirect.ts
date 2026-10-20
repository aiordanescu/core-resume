import { eq } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";

// After a change the old username keeps resolving this long, as an old resume address does.
const REDIRECT_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Keeps the user's current username working in public links for 30 days once it changes to `next`. The new name is
 * theirs now, so any redirect from it goes; a real account's username always wins over a redirect anyway.
 */
export async function recordUsernameChange(userId: string, next: string) {
	const [current] = await db
		.select({ username: schema.user.username })
		.from(schema.user)
		.where(eq(schema.user.id, userId));
	if (!current || current.username === next) return;
	const expiresAt = new Date(Date.now() + REDIRECT_LIFETIME_MS);
	await db.transaction(async (tx) => {
		await tx.delete(schema.usernameRedirect).where(eq(schema.usernameRedirect.username, next));
		await tx
			.insert(schema.usernameRedirect)
			.values({ username: current.username, userId, expiresAt })
			.onConflictDoUpdate({ target: schema.usernameRedirect.username, set: { userId, expiresAt } });
	});
}
