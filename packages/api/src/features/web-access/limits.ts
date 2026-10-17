import { eq } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import { careerProfile } from "@reactive-resume/db/schema";
import { aiLimitsSchema } from "@reactive-resume/schema/career";

/** Read here, not through the career service, which itself depends on web access. */
export async function webCallTimeoutMs(userId: string) {
	const [row] = await db
		.select({ aiLimits: careerProfile.aiLimits })
		.from(careerProfile)
		.where(eq(careerProfile.userId, userId));
	return aiLimitsSchema.parse(row?.aiLimits ?? {}).webCallTimeoutSeconds * 1000;
}
