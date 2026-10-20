type Run<T> = { promise: Promise<T>; controller: AbortController; callers: number };

const running = new Map<string, Run<unknown>>();

/**
 * Runs `work` once per key at a time. An identical request that arrives while one runs (a second tab, another device)
 * waits for the same result instead of starting a second model call. The work is cancelled only when every caller has
 * gone. Per process: replicas would need a shared store such as Redis.
 */
export function joinInFlight<T>(
	key: string,
	signal: AbortSignal | undefined,
	work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
	let run = running.get(key) as Run<T> | undefined;
	if (!run) {
		const controller = new AbortController();
		const promise = Promise.resolve()
			.then(() => work(controller.signal))
			.finally(() => {
				if (running.get(key) === created) running.delete(key);
			});
		const created: Run<T> = { promise, controller, callers: 0 };
		running.set(key, created);
		run = created;
	}
	const current = run;
	current.callers++;
	if (!signal) return current.promise;

	return new Promise<T>((resolve, reject) => {
		const leave = () => {
			current.callers--;
			if (current.callers === 0) {
				// A new request after everyone left starts fresh rather than joining a cancelled run.
				if (running.get(key) === current) running.delete(key);
				current.controller.abort(signal.reason);
			}
			reject(signal.reason);
		};
		if (signal.aborted) return leave();
		signal.addEventListener("abort", leave, { once: true });
		current.promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", leave));
	});
}
