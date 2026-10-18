import z from "zod";

/** How many pages a resume may run to before the editor flags overflow (Settings → Preferences). */
export const RESUME_PAGES = { min: 1, max: 99, default: 1 } as const;

export const resumePagesSchema = z.number().int().min(RESUME_PAGES.min).max(RESUME_PAGES.max);
