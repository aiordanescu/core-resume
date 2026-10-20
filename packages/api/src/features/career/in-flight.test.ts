import { describe, expect, it, vi } from "vitest";
import { joinInFlight } from "./in-flight";

function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((accept) => {
		resolve = accept;
	});
	return { promise, resolve };
}

describe("joinInFlight", () => {
	it("gives an identical request the running result instead of starting the work again", async () => {
		const result = deferred<string>();
		const work = vi.fn(() => result.promise);
		const first = joinInFlight("fit", new AbortController().signal, work);
		const second = joinInFlight("fit", new AbortController().signal, work);
		result.resolve("checked");
		await expect(Promise.all([first, second])).resolves.toEqual(["checked", "checked"]);
		expect(work).toHaveBeenCalledOnce();
	});

	it("runs different keys separately and starts again once a run has finished", async () => {
		const work = vi.fn(async () => "done");
		await Promise.all([joinInFlight("a", undefined, work), joinInFlight("b", undefined, work)]);
		await joinInFlight("a", undefined, work);
		expect(work).toHaveBeenCalledTimes(3);
	});

	it("keeps the work running while one caller remains, and cancels it when the last one leaves", async () => {
		let workSignal: AbortSignal | undefined;
		const result = deferred<string>();
		const work = (signal: AbortSignal) => {
			workSignal = signal;
			return result.promise;
		};
		const leaving = new AbortController();
		const staying = new AbortController();
		const left = joinInFlight("briefing", leaving.signal, work);
		const stayed = joinInFlight("briefing", staying.signal, work);
		await Promise.resolve();

		leaving.abort(new Error("closed tab"));
		await expect(left).rejects.toThrow("closed tab");
		expect(workSignal?.aborted).toBe(false);

		staying.abort(new Error("closed too"));
		await expect(stayed).rejects.toThrow("closed too");
		expect(workSignal?.aborted).toBe(true);

		const fresh = vi.fn(async () => "new run");
		await expect(joinInFlight("briefing", undefined, fresh)).resolves.toBe("new run");
		expect(fresh).toHaveBeenCalledOnce();
	});

	it("passes a failure to every caller and lets the next request try again", async () => {
		const failing = vi.fn(async () => {
			throw new Error("provider down");
		});
		const callers = [joinInFlight("reply", undefined, failing), joinInFlight("reply", undefined, failing)];
		await expect(Promise.all(callers)).rejects.toThrow("provider down");
		expect(failing).toHaveBeenCalledOnce();
		await expect(joinInFlight("reply", undefined, async () => "ok")).resolves.toBe("ok");
	});
});
