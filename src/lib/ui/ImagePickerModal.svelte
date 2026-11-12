<script lang="ts">
	/**
	 * The one place a picture is chosen, for an image step and for a text alike.
	 *
	 * Three sources, one result (`onselect(address)`, then the caller closes it):
	 *  - Z počítače: a file, dropped anywhere on the dialog or picked. It is uploaded
	 *    at once.
	 *  - Galerie: what this browser's workspace uploaded before. It is where the dialog
	 *    opens once there is something in it.
	 *  - Z webu: an `https://` address, the only kind the app loads.
	 *
	 * Closing the dialog while a file is on its way cancels the upload: a picture must
	 * not appear in the course after the teacher said no.
	 */
	import Modal from './Modal.svelte';
	import Button from './Button.svelte';
	import Segmented from './Segmented.svelte';
	import {
		deleteImage,
		imageAddress,
		imageErrorText,
		listImages,
		uploadImage,
		type ImageMeta
	} from '$lib/api/images';
	import { IMAGE_ACCEPT, IMAGE_LIMITS_TEXT, IMAGE_PROBLEM_TEXT } from '$lib/images/limits';
	import { imageInUse, removeImageReferences } from '$lib/domain/commands';
	import { isImageAddress } from './rich/paste';
	import { ImagePlus, Trash } from '@lucide/svelte';
	import { useStore } from './context';

	interface Props {
		onselect: (url: string) => void;
		onclose: () => void;
		ondelete?: (item: ImageMeta) => void;
	}
	let { onselect, onclose, ondelete }: Props = $props();

	const store = useStore();

	type Source = 'computer' | 'gallery' | 'web';
	const SOURCES: { value: Source; label: string }[] = [
		{ value: 'computer', label: 'Z počítače' },
		{ value: 'gallery', label: 'Galerie' },
		{ value: 'web', label: 'Z webu' }
	];
	/** `null` until the gallery has answered: it decides where the dialog opens. */
	let source = $state<Source | null>(null);

	// ── Gallery ───────────────────────────────────────────────────────────────
	let items = $state<ImageMeta[]>([]);
	let galleryError = $state<string | null>(null);
	/** Thumbnails that did not load. */
	let broken = $state<Record<string, true>>({});

	async function loadGallery() {
		galleryError = null;
		try {
			items = (await listImages()).items;
		} catch (e) {
			items = [];
			galleryError = imageErrorText(e, 'gallery');
		}
	}

	$effect(() => {
		void loadGallery().then(() => {
			source ??= items.length > 0 ? 'gallery' : 'computer';
		});
	});

	// ── From the computer ─────────────────────────────────────────────────────
	let fileInput = $state<HTMLInputElement | null>(null);
	let dragOver = $state(false);
	let upload = $state<AbortController | null>(null);
	let uploadError = $state<string | null>(null);

	async function take(files: FileList | null | undefined) {
		if (!files || files.length === 0 || upload) return;
		source = 'computer';
		if (files.length > 1) {
			uploadError = IMAGE_PROBLEM_TEXT.several;
			return;
		}
		uploadError = null;
		const mine = new AbortController();
		upload = mine;
		try {
			const meta = await uploadImage(files[0], mine.signal);
			if (!mine.signal.aborted) onselect(imageAddress(meta));
		} catch (e) {
			if (!mine.signal.aborted) uploadError = imageErrorText(e, 'upload');
		} finally {
			if (upload === mine) upload = null;
			// The same file can be chosen again after an error.
			if (fileInput) fileInput.value = '';
		}
	}

	function close() {
		upload?.abort();
		onclose();
	}
	// Unmounted by the owner without `close`: the upload goes with the dialog.
	$effect(() => () => upload?.abort());

	const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;

	// A file dropped beside the drop zone would otherwise replace the editor with the
	// picture, so the whole window takes it while the dialog is open.
	function ondragover(event: DragEvent) {
		if (!carriesFiles(event)) return;
		event.preventDefault();
		dragOver = true;
	}
	function ondrop(event: DragEvent) {
		if (!carriesFiles(event)) return;
		event.preventDefault();
		dragOver = false;
		void take(event.dataTransfer?.files);
	}

	// ── From the web ──────────────────────────────────────────────────────────
	let address = $state('');
	let addressError = $state<string | null>(null);

	function placeAddress(event: SubmitEvent) {
		event.preventDefault();
		const url = address.trim();
		if (!isImageAddress(url)) {
			addressError = 'Adresa obrázku musí začínat https:// — jinak se v aplikaci nenačte.';
			return;
		}
		onselect(url);
	}

	// ── Deleting from the gallery ─────────────────────────────────────────────
	let toDelete = $state<ImageMeta | null>(null);
	let deleting = $state(false);
	let deleteError = $state<string | null>(null);
	const usedHere = $derived(
		toDelete !== null && imageInUse(store.doc, toDelete.id, imageAddress(toDelete))
	);

	async function confirmDelete() {
		const item = toDelete;
		if (!item || deleting) return;
		deleting = true;
		deleteError = null;
		try {
			await deleteImage(item.id);
			store.apply((d) => removeImageReferences(d, item.id, imageAddress(item)));
			ondelete?.(item);
			items = items.filter((i) => i.id !== item.id);
			toDelete = null;
		} catch (e) {
			deleteError = imageErrorText(e, 'delete');
		} finally {
			deleting = false;
		}
	}
</script>

<svelte:window {ondragover} {ondrop} ondragleave={() => (dragOver = false)} />

<Modal title="Vybrat obrázek" size="l" onclose={close}>
	<div class="picker">
		{#if source === null}
			<p class="status">Načítám…</p>
		{:else}
			<Segmented
				label="Odkud obrázek vzít"
				options={SOURCES}
				value={source}
				onchange={(next) => (source = next)}
			/>

			{#if source === 'computer'}
				<input
					bind:this={fileInput}
					type="file"
					accept={IMAGE_ACCEPT}
					class="file-input"
					aria-label="Soubor s obrázkem"
					tabindex="-1"
					onchange={(event) => void take(event.currentTarget.files)}
				/>
				<div class="dropzone" class:drag-over={dragOver}>
					{#if upload}
						<p class="status" role="status">Nahrávám…</p>
					{:else}
						<ImagePlus size={32} />
						<span class="drop-primary">Přetáhni sem obrázek</span>
						<span class="drop-secondary">nebo</span>
						<Button variant="secondary" onclick={() => fileInput?.click()}>Vybrat soubor</Button>
						<span class="drop-hint">{IMAGE_LIMITS_TEXT}</span>
					{/if}
				</div>
				{#if uploadError}<p class="error-msg" role="alert">{uploadError}</p>{/if}
			{:else if source === 'gallery'}
				{#if galleryError}
					<p class="error-msg" role="alert">{galleryError}</p>
				{:else if items.length === 0}
					<p class="status">Zatím tu není žádný obrázek.</p>
				{:else}
					<ul class="gallery" aria-label="Galerie obrázků">
						{#each items as item (item.id)}
							<li class="card">
								<button
									type="button"
									class="pick"
									aria-label={item.name}
									onclick={() => onselect(imageAddress(item))}
								>
									{#if broken[item.id]}
										<span class="thumb unloaded">Obrázek se nenačetl</span>
									{:else}
										<img
											src={imageAddress(item)}
											alt=""
											class="thumb"
											loading="lazy"
											onerror={() => (broken[item.id] = true)}
										/>
									{/if}
									<span class="name" title={item.name}>{item.name}</span>
								</button>
								<button
									type="button"
									class="delete"
									title="Smazat obrázek"
									aria-label={`Smazat obrázek ${item.name}`}
									onclick={() => {
										deleteError = null;
										toDelete = item;
									}}
								>
									<Trash size={14} />
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			{:else}
				<form class="web" onsubmit={placeAddress}>
					<label>
						<span>Webová adresa obrázku</span>
						<!-- svelte-ignore a11y_autofocus -->
						<input
							type="url"
							bind:value={address}
							placeholder="https://…/obrazek.jpg"
							autofocus
							aria-invalid={addressError !== null || undefined}
							oninput={() => (addressError = null)}
						/>
					</label>
					<Button type="submit" variant="secondary">Vložit</Button>
				</form>
				{#if addressError}<p class="error-msg" role="alert">{addressError}</p>{/if}
			{/if}
		{/if}
	</div>

	{#snippet footer(notice)}
		{@render notice()}
		<Button variant="ghost" onclick={close}>Zrušit</Button>
	{/snippet}
</Modal>

{#if toDelete}
	<Modal
		title="Smazat obrázek?"
		onclose={() => {
			if (!deleting) toDelete = null;
		}}
	>
		<p class="delete-prompt">
			Obrázek <strong>{toDelete.name}</strong> zmizí z galerie{usedHere
				? ' i ze všech míst v tomto kurzu, kde je použitý'
				: ''}. Nejde to vrátit.
		</p>
		{#if deleteError}<p class="error-msg" role="alert">{deleteError}</p>{/if}
		{#snippet footer(notice)}
			{@render notice()}
			<Button variant="ghost" disabled={deleting} onclick={() => (toDelete = null)}>Zrušit</Button>
			<Button variant="danger-solid" disabled={deleting} onclick={confirmDelete}>
				{deleting ? 'Mažu…' : 'Smazat'}
			</Button>
		{/snippet}
	</Modal>
{/if}

<style>
	.picker {
		display: flex;
		flex-direction: column;
		gap: 16px;
		min-height: 300px;
	}

	.status {
		margin: auto;
		color: var(--e-text-muted);
		text-align: center;
	}

	.file-input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}

	.dropzone {
		display: flex;
		flex: 1;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		min-height: 220px;
		padding: 24px;
		border: 2px dashed var(--e-border-strong);
		border-radius: var(--radius-m);
		background: var(--primary-dark-06);
		color: var(--e-text-muted);
		text-align: center;
		transition:
			border-color 150ms,
			background 150ms;
	}

	.dropzone.drag-over {
		border-color: var(--primary);
		background: var(--primary-dark-12);
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

	.error-msg {
		margin: 0;
		padding: 8px 12px;
		border-radius: var(--radius-xs);
		background: var(--e-error-bg);
		color: var(--e-error-text);
		font-size: var(--text-s);
	}

	.gallery {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
		gap: 10px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.card {
		position: relative;
		display: flex;
		flex-direction: column;
	}

	.pick {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 6px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-s);
		background: var(--surface);
		cursor: pointer;
		text-align: center;
		transition:
			border-color 120ms,
			background 120ms;
	}

	.pick:hover,
	.pick:focus-visible {
		border-color: var(--primary);
		background: var(--primary-dark-06);
		outline: none;
	}

	.thumb {
		width: 100%;
		height: 90px;
		object-fit: cover;
		border-radius: var(--radius-xs);
		background: var(--surface-light);
	}

	.thumb.unloaded {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 6px;
		box-sizing: border-box;
		font: var(--type-caption);
		color: var(--e-text-faint);
	}

	.name {
		width: 100%;
		font: var(--type-caption);
		color: var(--e-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* An action of the thumbnail: there when the thumbnail is pointed at or focused. */
	.delete {
		position: absolute;
		top: 10px;
		right: 10px;
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
		opacity: 0;
		transition:
			opacity 120ms,
			color 120ms,
			background 120ms,
			border-color 120ms;
	}

	.card:hover .delete,
	.card:focus-within .delete {
		opacity: 1;
	}

	.delete:hover,
	.delete:focus-visible {
		color: var(--e-error-text);
		background: var(--e-error-bg);
		border-color: var(--e-error);
		outline: none;
	}

	.web {
		display: flex;
		align-items: flex-end;
		gap: 10px;
	}

	.web label {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 4px;
		font: var(--type-meta);
		color: var(--e-text-muted);
	}

	.web input {
		box-sizing: border-box;
		width: 100%;
		min-height: 34px;
		padding: 6px 8px;
		border: 1px solid transparent;
		border-bottom-color: var(--e-field-rest-rule);
		border-radius: var(--radius-xs);
		background: var(--e-field-rest);
		font: var(--type-body);
		color: var(--e-text);
	}

	.web input::placeholder {
		color: var(--e-text-faint);
		font-style: italic;
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
</style>
