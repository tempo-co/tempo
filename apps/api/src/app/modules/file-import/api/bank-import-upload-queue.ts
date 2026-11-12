import {Injectable} from '@nestjs/common';

/** How many uploads the API holds in memory at once, across all owners. */
export const MAX_CONCURRENT_UPLOADS = 2;
/** How long an upload waits for a slot before it is refused as busy. */
export const UPLOAD_WAIT_MS = 30_000;

/** Gives the slot back. Calling it again does nothing. */
export type ReleaseUploadSlot = () => void;

/** Why a wait for a slot ended without one. */
export class UploadWaitEnded extends Error {
	constructor(readonly reason: 'timeout' | 'aborted') {
		super(reason === 'timeout' ? 'No upload slot came free in time.' : 'The upload was closed while it waited.');
	}
}

type Waiter = {grant: () => void};

/**
 * Lets at most `MAX_CONCURRENT_UPLOADS` uploads be read and imported at once, per API process. Later ones wait in
 * arrival order, holding none of their bytes: they wait before their body is read. A finishing upload hands its slot
 * straight to the next waiter, so no newcomer can take it in between.
 */
@Injectable()
export class BankImportUploadQueue {
	private active = 0;
	private readonly waiting: Waiter[] = [];

	/**
	 * Resolves with the slot's release once one is free. Rejects with `UploadWaitEnded` after `UPLOAD_WAIT_MS`, or
	 * when `signal` aborts first; either way the waiter has left the queue and holds nothing.
	 */
	acquire(signal: AbortSignal): Promise<ReleaseUploadSlot> {
		if (signal.aborted) return Promise.reject(new UploadWaitEnded('aborted'));
		if (this.active < MAX_CONCURRENT_UPLOADS) {
			this.active++;
			return Promise.resolve(this.release());
		}
		return new Promise((resolve, reject) => {
			const waiter: Waiter = {
				grant: () => {
					stopWaiting();
					resolve(this.release());
				},
			};
			// A waiter that was granted its slot is no longer in the queue, so a late abort or timeout leaves it be.
			const leave = (reason: UploadWaitEnded['reason']) => {
				const index = this.waiting.indexOf(waiter);
				if (index === -1) return;
				this.waiting.splice(index, 1);
				stopWaiting();
				reject(new UploadWaitEnded(reason));
			};
			const onAbort = () => leave('aborted');
			const timer = setTimeout(() => leave('timeout'), UPLOAD_WAIT_MS);
			const stopWaiting = () => {
				clearTimeout(timer);
				signal.removeEventListener('abort', onAbort);
			};
			signal.addEventListener('abort', onAbort, {once: true});
			this.waiting.push(waiter);
		});
	}

	private release(): ReleaseUploadSlot {
		let released = false;
		return () => {
			if (released) return;
			released = true;
			const next = this.waiting.shift();
			if (next) next.grant();
			else this.active--;
		};
	}
}
