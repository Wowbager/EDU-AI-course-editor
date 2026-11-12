/**
 * Uploaded image storage on the editor's server.
 *
 * Layout under DATA_DIR:
 *
 *     images/<id>                          — the raw files, publicly accessible
 *     owners/<owner>/images/index.json     — owner's gallery index
 *
 * Images are stored in the public images directory so they can be loaded from
 * anywhere (student app, Flutter player, browser <img>, other origins) without
 * authentication. The owner index tracks who uploaded which image for the gallery.
 *
 * This is a temporary backend: when a Cloudflare service takes over, the upload
 * endpoint and this module are swapped out. The client and modal see the same
 * `ImageMeta` shape either way.
 */
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from '../../images/limits';

export { MAX_IMAGE_BYTES };
export const MAX_IMAGES_PER_OWNER = 500;

export const ALLOWED_MIME = new Set<string>(IMAGE_TYPES.map((type) => type.mime));

/** Extension to serve back for each MIME type. */
export const MIME_TO_EXT: Record<string, string> = Object.fromEntries(
	IMAGE_TYPES.map((type) => [type.mime, type.ext])
);

export const EXT_TO_MIME: Record<string, string> = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.svg': 'image/svg+xml',
	'.avif': 'image/avif',
	'.bmp': 'image/bmp'
};

export class ImageError extends Error {
	constructor(
		readonly status: 400 | 404 | 413 | 415 | 429,
		message: string
	) {
		super(message);
	}
}

export interface ImageMeta {
	id: string;
	name: string;
	/** Relative URL path to load the image: `/images/file/<id>` */
	url: string;
	size: number;
	uploadedAt: string;
	mimeType: string;
}

interface ImageIndex {
	items: ImageMeta[];
}

export interface ServedFile {
	/** Readable stream of the file bytes. */
	stream: ReturnType<typeof createReadStream>;
	contentType: string;
	size: number;
}

/** Owner id validation — same pattern as VersionFiles. */
const OWNER_RE = /^ws_[0-9a-f]{64}$|^user_[A-Za-z0-9_-]{1,64}$/;

/** Public image ID validation: UUID with optional sanitized filename slug + extension. */
export const IMAGE_ID_RE = /^[0-9a-f-]{36}(?:-[A-Za-z0-9_-]{1,60})?\.[a-z0-9]{2,5}$/i;

export class ImageFiles {
	#root: string;
	#queues = new Map<string, Promise<unknown>>();

	constructor(root: string) {
		this.#root = root;
	}

	#ownerDir(owner: string): string {
		if (!OWNER_RE.test(owner)) throw new ImageError(400, 'Neplatný vlastník.');
		return join(this.#root, 'owners', owner, 'images');
	}

	#publicDir(): string {
		return join(this.#root, 'images');
	}

	/** Run writes for one owner's images serially. */
	#serial<T>(key: string, work: () => Promise<T>): Promise<T> {
		const previous = this.#queues.get(key) ?? Promise.resolve();
		const next = previous.catch(() => {}).then(work);
		this.#queues.set(key, next);
		next
			.finally(() => {
				if (this.#queues.get(key) === next) this.#queues.delete(key);
			})
			.catch(() => {});
		return next;
	}

	/** List all uploaded images for the owner. */
	async list(owner: string): Promise<ImageIndex> {
		const dir = this.#ownerDir(owner);
		const index = await readIndex(dir);
		return index;
	}

	/**
	 * Store one uploaded image.
	 *
	 * Saved in `DATA_DIR/images/<id>` so it is publicly reachable from anywhere.
	 * Indexed under the owner's gallery index.
	 */
	async upload(
		owner: string,
		bytes: Uint8Array,
		originalName: string,
		mimeType: string
	): Promise<ImageMeta> {
		if (!ALLOWED_MIME.has(mimeType)) {
			throw new ImageError(415, `Nepodporovaný typ souboru: ${mimeType}`);
		}
		if (bytes.byteLength > MAX_IMAGE_BYTES) {
			throw new ImageError(413, `Soubor je větší než ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
		}

		const ownerDir = this.#ownerDir(owner);
		const publicDir = this.#publicDir();

		return this.#serial(owner, async () => {
			const index = await readIndex(ownerDir);
			if (index.items.length >= MAX_IMAGES_PER_OWNER) {
				throw new ImageError(429, `Galerie je plná (maximum ${MAX_IMAGES_PER_OWNER} obrázků).`);
			}

			const ext = MIME_TO_EXT[mimeType] ?? (extname(originalName).toLowerCase() || '.bin');
			const safeSlug = sanitiseName(originalName)
				.replace(/\.[^.]+$/, '')
				.replace(/[^a-zA-Z0-9_-]/g, '_')
				.slice(0, 40);
			const id = safeSlug ? `${randomUUID()}-${safeSlug}${ext}` : `${randomUUID()}${ext}`;

			const filePath = join(publicDir, id);
			await mkdir(publicDir, { recursive: true });
			await atomicWriteBinary(filePath, bytes);

			const meta: ImageMeta = {
				id,
				name: sanitiseName(originalName),
				url: `/images/file/${encodeURIComponent(id)}`,
				size: bytes.byteLength,
				uploadedAt: new Date().toISOString(),
				mimeType
			};

			await mkdir(ownerDir, { recursive: true });
			const updated: ImageIndex = { items: [meta, ...index.items] };
			await atomicWriteJson(join(ownerDir, 'index.json'), updated);
			return meta;
		});
	}

	/**
	 * Remove an image from the owner's gallery index and delete the file
	 * from public storage.
	 */
	async delete(owner: string, id: string): Promise<boolean> {
		if (!IMAGE_ID_RE.test(id)) return false;
		const ownerDir = this.#ownerDir(owner);
		const publicDir = this.#publicDir();

		return this.#serial(owner, async () => {
			const index = await readIndex(ownerDir);
			const idx = index.items.findIndex((item) => item.id === id);
			if (idx === -1) {
				return false;
			}
			index.items.splice(idx, 1);
			await mkdir(ownerDir, { recursive: true });
			await atomicWriteJson(join(ownerDir, 'index.json'), index);

			try {
				await rm(join(publicDir, id), { force: true });
			} catch {
				// Non-fatal if already removed
			}

			return true;
		});
	}

	/**
	 * Serve the raw bytes of one uploaded image publicly by its ID.
	 * Returns `null` for a missing or invalid id.
	 */
	async serveFile(id: string): Promise<ServedFile | null> {
		if (!IMAGE_ID_RE.test(id)) return null;

		const publicPath = join(this.#publicDir(), id);
		try {
			const info = await stat(publicPath);
			const ext = extname(id).toLowerCase();
			const contentType = EXT_TO_MIME[ext] ?? 'application/octet-stream';
			return {
				stream: createReadStream(publicPath),
				contentType,
				size: info.size
			};
		} catch {
			// Fallback check in legacy owner dirs if needed
			return null;
		}
	}
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function readIndex(dir: string): Promise<ImageIndex> {
	try {
		const text = await readFile(join(dir, 'index.json'), 'utf8');
		const parsed = JSON.parse(text) as unknown;
		if (
			typeof parsed === 'object' &&
			parsed !== null &&
			Array.isArray((parsed as ImageIndex).items)
		) {
			return parsed as ImageIndex;
		}
	} catch {
		// Missing or corrupt — start fresh.
	}
	return { items: [] };
}

async function atomicWriteJson(path: string, value: unknown) {
	const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(temp, JSON.stringify(value), 'utf8');
	await rename(temp, path);
}

async function atomicWriteBinary(path: string, bytes: Uint8Array) {
	const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(temp, bytes);
	await rename(temp, path);
}

/** Strip path traversal attempts and control characters from the original filename. */
export function sanitiseName(raw: string): string {
	const base = basename(raw.replace(/\\/g, '/'));
	return (
		base
			.replace(/[/\\<>:"|?*\x00-\x1f]/g, '_')
			.replace(/\.{2,}/g, '_')
			.replace(/^\.+/, '_')
			.slice(0, 200) || 'image'
	);
}
