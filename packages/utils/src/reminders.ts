import z from "zod";

/**
 * Days at Applied without a reply before the app suggests a follow-up (Settings → Preferences → Reminders).
 * 0 turns the suggestion off.
 */
export const NO_REPLY_DAYS = { min: 0, max: 90, default: 10 } as const;

export const noReplyDaysSchema = z.number().int().min(NO_REPLY_DAYS.min).max(NO_REPLY_DAYS.max);
