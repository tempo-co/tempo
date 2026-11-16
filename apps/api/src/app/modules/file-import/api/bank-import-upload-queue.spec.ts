import {
	BankImportUploadQueue,
	MAX_CONCURRENT_UPLOADS,
	UPLOAD_WAIT_MS,
	UploadWaitEnded,
} from './bank-import-upload-queue';

/** A waiting acquire, with whether it has settled yet. */
function track(queue: BankImportUploadQueue, signal = new AbortController().signal) {
	const state: {settled: boolean; error?: unknown; release?: () => void} = {settled: false};
	const promise = queue.acquire(signal).then(
		(release) => Object.assign(state, {settled: true, release}),
		(error: unknown) => Object.assign(state, {settled: true, error}),
	);
	return Object.assign(state, {promise});
}

/** Lets settled promises run their callbacks; microtasks only, so it works under fake timers too. */
async function flush() {
	for (let turn = 0; turn < 5; turn++) await Promise.resolve();
}

describe('BankImportUploadQueue', () => {
	afterEach(() => jest.useRealTimers());

	it('holds two uploads at once and hands each freed slot to the longest waiter', async () => {
		expect(MAX_CONCURRENT_UPLOADS).toBe(2);
		const queue = new BankImportUploadQueue();
		const first = track(queue);
		const second = track(queue);
		const third = track(queue);
		const fourth = track(queue);
		await flush();
		expect([first.settled, second.settled, third.settled, fourth.settled]).toEqual([true, true, false, false]);

		second.release!();
		await flush();
		expect([third.settled, fourth.settled]).toEqual([true, false]);

		// A slot released twice is given back once: the fourth upload still waits for a real release.
		second.release!();
		await flush();
		expect(fourth.settled).toBe(false);

		first.release!();
		await flush();
		expect(fourth.settled).toBe(true);
		third.release!();
		fourth.release!();

		// With every slot back, the next two start at once.
		const again = [track(queue), track(queue), track(queue)];
		await flush();
		expect(again.map(({settled}) => settled)).toEqual([true, true, false]);
		again[0].release!();
		await flush();
		expect(again[2].settled).toBe(true);
	});

	it('lets a waiter whose client leaves go without taking or freeing a slot', async () => {
		const queue = new BankImportUploadQueue();
		const holders = [track(queue), track(queue)];
		const leaving = new AbortController();
		const gone = track(queue, leaving.signal);
		const next = track(queue);
		await flush();

		leaving.abort();
		await flush();
		expect(gone.error).toEqual(new UploadWaitEnded('aborted'));
		// The two holders still hold both slots.
		expect(next.settled).toBe(false);

		holders[0].release!();
		await flush();
		expect(next.release).toBeDefined();
		// An abort after the slot was granted changes nothing.
		const late = new AbortController();
		holders[1].release!();
		const after = track(queue, late.signal);
		await flush();
		late.abort();
		expect(after.release).toBeDefined();
	});

	it('refuses a waiter that waited too long, and the queue moves on without it', async () => {
		jest.useFakeTimers();
		const queue = new BankImportUploadQueue();
		const holders = [track(queue), track(queue)];
		const timedOut = track(queue);
		await flush();

		jest.advanceTimersByTime(UPLOAD_WAIT_MS - 1);
		await flush();
		expect(timedOut.settled).toBe(false);
		const later = track(queue);
		jest.advanceTimersByTime(1);
		await flush();
		expect(timedOut.error).toEqual(new UploadWaitEnded('timeout'));

		holders[0].release!();
		await flush();
		expect(later.release).toBeDefined();
	});

	it('refuses a client that already left without queueing it', async () => {
		const queue = new BankImportUploadQueue();
		const left = new AbortController();
		left.abort();
		await expect(queue.acquire(left.signal)).rejects.toEqual(new UploadWaitEnded('aborted'));
		const both = [track(queue), track(queue)];
		await flush();
		expect(both.every(({release}) => release)).toBe(true);
	});
});
