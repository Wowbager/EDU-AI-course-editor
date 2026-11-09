<script lang="ts">
	/**
	 * Modal for uploading and picking images.
	 *
	 * Two tabs:
	 *  - Nahrát: a drag-and-drop zone + file browser button. Uploads immediately,
	 *    then calls `onselect(url)` and closes.
	 *  - Galerie: a grid of previously uploaded images. Clicking one calls
	 *    `onselect(url)` and closes.
	 *
	 * The workspace key is read from `state/versions/server.ts` — the same key the
	 * version backend uses, so no second identity is introduced.
	 */
	import Modal from '$lib/ui/Modal.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { uploadImage, listImages, deleteImage, type ImageMeta } from '$lib/api/images';
	import { workspaceKey } from '$lib/state/versions/server';
	import { ImagePlus, Images, Upload, Loader, Trash } from '@lucide/svelte';
	import { useStore } from '$lib/ui/context';
	import { removeImageReferences } from '$lib/domain/commands';

	interface Props {
		onselect: (url: string) => void;
		onclose: () => void;
		ondelete?: (item: ImageMeta) => void;
	}
	let { onselect, onclose, ondelete }: Props = $props();

	const store = useStore();

	type Tab = 'upload' | 'gallery';
	let activeTab = $state<Tab>('upload');

	// ── Upload tab state ──────────────────────────────────────────────────────
	let fileInput = $state<HTMLInputElement | null>(null);
	let dragOver = $state(false);
	let uploading = $state(false);
	let uploadError = $state<string | null>(null);

	function openFilePicker() {
		fileInput?.click();
	}

	function toPublicUrl(url: string): string {
		if (url.startsWith('http://') || url.startsWith('https://')) return url;
		if (typeof window !== 'undefined' && url.startsWith('/')) {
			return `${window.location.origin}${url}`;
		}
		return url;
	}

	async function handleFiles(files: FileList | null) {
		if (!files || files.length === 0) return;
		const file = files[0];
		uploadError = null;
		uploading = true;
		try {
			const key = workspaceKey();
			if (!key) throw new Error('Klíč pracovního prostoru není k dispozici.');
			const meta = await uploadImage(file, key);
			onselect(toPublicUrl(meta.url));
		} catch (e) {
			uploadError = e instanceof Error ? e.message : 'Nahrávání selhalo.';
		} finally {
			uploading = false;
		}
	}

	function onFileInputChange(event: Event) {
		handleFiles((event.currentTarget as HTMLInputElement).files);
	}

	function onDragOver(event: DragEvent) {
		event.preventDefault();
		dragOver = true;
	}

	function onDragLeave() {
		dragOver = false;
	}

	function onDrop(event: DragEvent) {
		event.preventDefault();
		dragOver = false;
		handleFiles(event.dataTransfer?.files ?? null);
	}

	// ── Gallery tab state ─────────────────────────────────────────────────────
	let galleryItems = $state<ImageMeta[]>([]);
	let galleryLoading = $state(false);
	let galleryError = $state<string | null>(null);
	let galleryLoaded = $state(false);
	let itemToDelete = $state<ImageMeta | null>(null);
	let deleting = $state(false);
	let deleteError = $state<string | null>(null);

	async function loadGallery() {
		if (galleryLoaded) return;
		galleryLoading = true;
		galleryError = null;
		try {
			const key = workspaceKey();
			if (!key) throw new Error('Klíč pracovního prostoru není k dispozici.');
			const index = await listImages(key);
			galleryItems = index.items;
			galleryLoaded = true;
		} catch (e) {
			galleryError = e instanceof Error ? e.message : 'Galerie se nepodařila načíst.';
		} finally {
			galleryLoading = false;
		}
	}

	async function confirmDelete() {
		if (!itemToDelete) return;
		deleting = true;
		deleteError = null;
		try {
			const key = workspaceKey();
			if (!key) throw new Error('Klíč pracovního prostoru není k dispozici.');
			await deleteImage(itemToDelete.id, key);
			if (store) {
				store.apply((d) => removeImageReferences(d, itemToDelete!.id, itemToDelete!.url));
			}
			ondelete?.(itemToDelete);
			galleryItems = galleryItems.filter((i) => i.id !== itemToDelete!.id);
			itemToDelete = null;
		} catch (e) {
			deleteError = e instanceof Error ? e.message : 'Smazání se nezdařilo.';
		} finally {
			deleting = false;
		}
	}

	function switchTab(tab: Tab) {
		activeTab = tab;
		if (tab === 'gallery') loadGallery();
	}

	function pickFromGallery(item: ImageMeta) {
		onselect(toPublicUrl(item.url));
	}

	/** Human-readable file size. */
	function formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	}
</script>

<Modal title="Vybrat obrázek" size="l" {onclose}>
	<div class="picker">
		<!-- Tab bar -->
		<div class="tabs" role="tablist">
			<button
				type="button"
				role="tab"
				class="tab"
				class:active={activeTab === 'upload'}
				aria-selected={activeTab === 'upload'}
				onclick={() => switchTab('upload')}
			>
				<Upload size={14} />
				Nahrát
			</button>
			<button
				type="button"
				role="tab"
				class="tab"
				class:active={activeTab === 'gallery'}
				aria-selected={activeTab === 'gallery'}
				onclick={() => switchTab('gallery')}
			>
				<Images size={14} />
				Galerie
			</button>
		</div>

		<!-- Upload tab -->
		{#if activeTab === 'upload'}
			<div class="tab-panel" role="tabpanel" aria-label="Nahrát obrázek">
				<!-- Hidden file input -->
				<input
					bind:this={fileInput}
					type="file"
					accept="image/*"
					class="file-input"
					aria-hidden="true"
					tabindex="-1"
					onchange={onFileInputChange}
				/>

				<!-- Drop zone -->
				<div
					class="dropzone"
					class:drag-over={dragOver}
					class:busy={uploading}
					role="button"
					tabindex="0"
					aria-label="Přetáhni obrázek sem nebo stiskni pro výběr souboru"
					ondragover={onDragOver}
					ondragleave={onDragLeave}
					ondrop={onDrop}
					onclick={openFilePicker}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							openFilePicker();
						}
					}}
				>
					{#if uploading}
						<div class="drop-content">
							<Loader size={32} class="spin" />
							<span>Nahrávání…</span>
						</div>
					{:else}
						<div class="drop-content">
							<ImagePlus size={32} />
							<span class="drop-primary">Přetáhni sem obrázek</span>
							<span class="drop-secondary">nebo</span>
							<Button variant="secondary" size="s" onclick={openFilePicker}>
								Vybrat ze souborů
							</Button>
							<span class="drop-hint">JPG, PNG, WebP, GIF, SVG, AVIF — max. 10 MB</span>
						</div>
					{/if}
				</div>

				{#if uploadError}
					<p class="error-msg" role="alert">{uploadError}</p>
				{/if}
			</div>

			<!-- Gallery tab -->
		{:else}
			<div class="tab-panel" role="tabpanel" aria-label="Galerie obrázků">
				{#if galleryLoading}
					<div class="gallery-status">
						<Loader size={24} class="spin" />
						<span>Načítání galerie…</span>
					</div>
				{:else if galleryError}
					<p class="error-msg" role="alert">{galleryError}</p>
				{:else if galleryItems.length === 0}
					<div class="gallery-status">
						<Images size={32} />
						<span>Zatím jsi nenahrál žádný obrázek.</span>
						<Button variant="secondary" size="s" onclick={() => switchTab('upload')}>
							Nahrát první obrázek
						</Button>
					</div>
				{:else}
					<div class="gallery-grid">
						{#each galleryItems as item (item.id)}
							<div class="gallery-card">
								<button
									type="button"
									class="gallery-select"
									title={`${item.name} (${formatSize(item.size)})`}
									onclick={() => pickFromGallery(item)}
								>
									<img src={item.url} alt={item.name} class="gallery-thumb" loading="lazy" />
									<span class="gallery-name">{item.name}</span>
								</button>
								<button
									type="button"
									class="gallery-delete-btn"
									title="Smazat obrázek"
									aria-label={`Smazat obrázek ${item.name}`}
									onclick={(e) => {
										e.stopPropagation();
										deleteError = null;
										itemToDelete = item;
									}}
								>
									<Trash size={14} />
								</button>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>

	{#snippet footer(notice)}
		{@render notice()}
		<Button variant="ghost" onclick={onclose}>Zrušit</Button>
	{/snippet}
</Modal>

{#if itemToDelete}
	<Modal
		title="Smazat obrázek?"
		onclose={() => {
			if (!deleting) itemToDelete = null;
		}}
	>
		<p class="delete-prompt">
			Opravdu chceš smazat obrázek <strong>{itemToDelete.name}</strong> z galerie?
		</p>
		{#if deleteError}
			<p class="error-msg" role="alert">{deleteError}</p>
		{/if}
		{#snippet footer(notice)}
			{@render notice()}
			<Button
				variant="ghost"
				disabled={deleting}
				onclick={() => {
					itemToDelete = null;
				}}
			>
				Zrušit
			</Button>
			<Button variant="danger-solid" disabled={deleting} onclick={confirmDelete}>
				{#if deleting}
					<Loader size={14} class="spin" />
					Smazání…
				{:else}
					Smazat
				{/if}
			</Button>
		{/snippet}
	</Modal>
{/if}

<style>
	.picker {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	/* ── Tabs ────────────────────────────────────────────────────────────────── */

	.tabs {
		display: flex;
		gap: 4px;
		border-bottom: 1px solid var(--e-border);
		padding-bottom: 0;
		margin-bottom: 4px;
	}

	.tab {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border: 1px solid transparent;
		border-bottom: none;
		border-radius: var(--radius-xs) var(--radius-xs) 0 0;
		background: none;
		color: var(--e-text-muted);
		font: var(--type-meta-bold);
		cursor: pointer;
		transition: background 100ms;
		margin-bottom: -1px;
	}

	.tab:hover {
		background: var(--primary-dark-06);
		color: var(--e-text);
	}

	.tab.active {
		background: var(--surface);
		border-color: var(--e-border);
		color: var(--e-text);
	}

	/* ── Tab panels ──────────────────────────────────────────────────────────── */

	.tab-panel {
		display: flex;
		flex-direction: column;
		gap: 12px;
		min-height: 240px;
	}

	.file-input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}

	/* ── Drop zone ───────────────────────────────────────────────────────────── */

	.dropzone {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 220px;
		border: 2px dashed var(--e-border-strong);
		border-radius: var(--radius-m);
		background: var(--primary-dark-06);
		cursor: pointer;
		transition:
			border-color 150ms,
			background 150ms;
	}

	.dropzone:hover,
	.dropzone:focus-visible {
		border-color: var(--primary);
		background: var(--primary-dark-08);
		outline: none;
	}

	.dropzone.drag-over {
		border-color: var(--gradient-purple);
		background: var(--primary-dark-12);
	}

	.dropzone.busy {
		cursor: default;
		pointer-events: none;
	}

	.drop-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		color: var(--e-text-muted);
		text-align: center;
		padding: 24px;
	}

	.drop-primary {
		font: var(--type-body-semibold);
		color: var(--e-text);
	}

	.drop-secondary {
		font: var(--type-meta);
		margin: -4px 0;
	}

	.drop-hint {
		font: var(--type-caption);
		color: var(--e-text-faint);
		margin-top: 4px;
	}

	/* ── Error ───────────────────────────────────────────────────────────────── */

	.error-msg {
		margin: 0;
		padding: 8px 12px;
		border-radius: var(--radius-xs);
		background: var(--e-error-bg);
		color: var(--e-error-text);
		font-size: var(--text-s);
	}

	/* ── Gallery ─────────────────────────────────────────────────────────────── */

	.gallery-status {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		min-height: 220px;
		color: var(--e-text-muted);
		text-align: center;
	}

	.gallery-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
		gap: 10px;
	}

	.gallery-card {
		position: relative;
		display: flex;
		flex-direction: column;
	}

	.gallery-select {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 6px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-s);
		background: var(--surface);
		cursor: pointer;
		width: 100%;
		transition:
			border-color 120ms,
			background 120ms;
		text-align: center;
	}

	.gallery-select:hover,
	.gallery-select:focus-visible {
		border-color: var(--primary);
		background: var(--primary-dark-06);
		outline: none;
	}

	.gallery-delete-btn {
		position: absolute;
		top: 6px;
		right: 6px;
		z-index: 2;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		padding: 0;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-xs);
		background: var(--surface);
		color: var(--e-text-muted);
		cursor: pointer;
		opacity: 0.7;
		transition:
			opacity 120ms,
			color 120ms,
			background 120ms,
			border-color 120ms;
	}

	.gallery-card:hover .gallery-delete-btn,
	.gallery-delete-btn:focus-visible {
		opacity: 1;
	}

	.gallery-delete-btn:hover,
	.gallery-delete-btn:focus-visible {
		opacity: 1;
		color: var(--e-error-text);
		background: var(--e-error-bg);
		border-color: var(--e-error);
		outline: none;
	}

	.delete-prompt {
		margin: 0;
		color: var(--e-text);
		font: var(--type-body);
		line-height: 1.5;
	}

	.delete-prompt strong {
		word-break: break-all;
	}

	.gallery-thumb {
		width: 100%;
		height: 90px;
		object-fit: cover;
		border-radius: var(--radius-xs);
		background: var(--surface-light);
	}

	.gallery-name {
		width: 100%;
		font: var(--type-caption);
		color: var(--e-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* ── Spinner animation ───────────────────────────────────────────────────── */

	:global(.spin) {
		animation: spin 0.9s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
