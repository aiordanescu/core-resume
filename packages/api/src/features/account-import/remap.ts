/** Kinds of record an import gives new ids, and that later records point at. */
export const ID_KINDS = ["resume", "letter", "application", "fact", "story", "artifact", "schedule", "thread"] as const;
export type IdKind = (typeof ID_KINDS)[number];

/** Old id → new id, per kind. */
export type IdMaps = { [K in IdKind]?: Record<string, string> | undefined };

/** All kinds in one lookup. Ids are random and unique across tables, so kinds can't collide. */
export function flattenIds(ids: IdMaps): Map<string, string> {
	const flat = new Map<string, string>();
	for (const kind of ID_KINDS) for (const [from, to] of Object.entries(ids[kind] ?? {})) flat.set(from, to);
	return flat;
}

// Workspace ticks name what they tick as "plan:{savedItemId}" or "now:{interviewId}".
const PREFIXED = /^([a-z]+):(.+)$/;

/**
 * Rewrites the ids stored inside JSON (story facts, saved items' evidence, workspace answers and ticks): a string that
 * is an old id, or `prefix:old id`, becomes the new one. Everything else, unknown ids included, is kept as it is.
 */
export function remapIds<T>(value: T, ids: ReadonlyMap<string, string>): T {
	if (typeof value === "string") {
		const direct = ids.get(value);
		if (direct) return direct as T;
		const prefixed = PREFIXED.exec(value);
		const mapped = prefixed?.[2] ? ids.get(prefixed[2]) : undefined;
		return (mapped ? `${prefixed?.[1]}:${mapped}` : value) as T;
	}
	if (Array.isArray(value)) return value.map((item: unknown) => remapIds(item, ids)) as T;
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapIds(item, ids)] as const)) as T;
	}
	return value;
}

/** The new ids of a list of old ones, dropping any that weren't imported. */
export function mapIdList(list: readonly string[], ids: ReadonlyMap<string, string>): string[] {
	return list.flatMap((id) => {
		const mapped = ids.get(id);
		return mapped ? [mapped] : [];
	});
}
