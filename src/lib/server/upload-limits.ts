/**
 * How much one client address may upload: files a minute and bytes a day. A workspace
 * key is made up by the browser, so a per-workspace quota alone does not bound the disk.
 * In memory, like the AI limits (`ai/limits.ts`, whose counter this reuses: its
 * "tokens" are bytes here).
 */
import { AiLimits, type LimitVerdict } from './ai/limits';

const MB = 1024 * 1024;

export class UploadLimits {
	#limits: AiLimits;
	constructor(options: { perMinute: number; bytesPerDay: number; now?: () => number }) {
		this.#limits = new AiLimits({
			maxRequestsPerMinute: options.perMinute,
			dailyTokenBudget: options.bytesPerDay,
			now: options.now
		});
	}

	/** Counts the upload when it is allowed. */
	admit(client: string, bytes: number): LimitVerdict {
		const verdict = this.#limits.check(client);
		if (verdict.ok) this.#limits.record(client, bytes);
		return verdict;
	}
}

/** A picture is a few MB; a school is one address. */
export const pictureUploads = new UploadLimits({ perMinute: 60, bytesPerDay: 1000 * MB });
/** Attaching a course's materials sends up to 30 files at once. */
export const materialUploads = new UploadLimits({ perMinute: 120, bytesPerDay: 1000 * MB });
/** The preview's pictures, fetched by the server: a course has many, the browser keeps them. */
export const previewFetches = new UploadLimits({ perMinute: 600, bytesPerDay: Infinity });
