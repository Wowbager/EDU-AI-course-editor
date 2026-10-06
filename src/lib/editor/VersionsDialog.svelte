<script lang="ts">
	/**
	 * Version control for the course: save the working copy as a numbered version,
	 * return to one, publish one — and say who the course is for.
	 *
	 * It replaces the per-card status, which nothing downstream read, and the course
	 * status buried in the course settings. A teacher gets three answers to "who sees
	 * it" (private with a PIN, everyone, signed-in students); the metodik's editorial
	 * states (rozpracovaný, schválený, k revizi) appear from Metodik up. Numbers only
	 * grow, because the app offers students an update only when they do — so putting
	 * an older version out again makes it a new number, and the dialog says so before
	 * it happens (`domain/versions.ts`).
	 *
	 * Publishing is not wired to the API yet (its sign-in is unresolved), so a
	 * published version is also downloaded, ready to upload in the administration.
	 *
	 * What it says is the model's (`store.screen.dialogs.versions`, `screen/versions.ts`);
	 * what it is in the middle of (the note, a busy save, the message, a publication
	 * waiting for "i tak") is `store.ui.versions`. This does the async work the history
	 * store owns.
	 */
	import Modal from '$lib/ui/Modal.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Chip from '$lib/ui/Chip.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import { useStore, useVersions } from '$lib/ui/context';
	import { restoreVersion, setVisibility } from '$lib/domain/commands';
	import {
		VISIBILITY_LABEL,
		contentHash,
		publishCheck,
		summariseDiff,
		visibilityOf,
		type Visibility
	} from '$lib/domain/versions';
	import { courseFileName } from '$lib/domain/filename';
	import { downloadCourse } from '$lib/ui/download';
	import { Download, History, RotateCcw, Send } from '@lucide/svelte';
	import type { VersionsView } from '$lib/screen/types';

	interface Props {
		view: VersionsView;
		onclose: () => void;
		/** Opens the export review, for a version that is the working copy. */
		onreview: () => void;
	}
	let { view, onclose, onreview }: Props = $props();

	const store = useStore();
	const versions = useVersions();
	const screen = 'dialogs.versions';
	const form = $derived(store.ui.versions);

	// Versions are of the course as exported, not of the view the editor shows.
	const doc = $derived(store.source);

	async function save() {
		form.busy = true;
		form.message = null;
		try {
			const saved = await versions.save(doc, form.note);
			form.note = '';
			form.message = { tone: 'ok', text: `Uloženo jako verze ${saved.version}.` };
		} catch (error) {
			form.message = {
				tone: 'error',
				text: error instanceof Error ? error.message : String(error)
			};
		} finally {
			form.busy = false;
		}
	}

	async function restore(number: number) {
		if (
			store.versionState.modified &&
			!window.confirm(
				`Rozpracované změny se nahradí verzí ${number}. Vrátit to půjde tlačítkem Zpět.`
			)
		)
			return;
		const saved = await versions.get(number);
		if (saved === null) {
			form.message = { tone: 'error', text: `Verzi ${number} se nepodařilo načíst.` };
			return;
		}
		store.applySource((d) => restoreVersion(d, saved.doc, number));
		// A version saved before questions had their own cards is split like an import.
		store.splitQuestions();
		form.message = { tone: 'ok', text: `Rozpracovaná verze je teď obsah verze ${number}.` };
	}

	async function download(number: number) {
		const saved = await versions.get(number);
		if (saved === null) return;
		downloadCourse(saved.doc, courseFileName(saved.doc.name, doc.course_id, `-v${number}`));
	}

	/** Check the version, then publish it — or say what stands in the way. */
	async function requestPublish(number: number, anyway = false) {
		form.refused = null;
		form.confirming = null;
		const saved = await versions.get(number);
		if (saved === null) return;
		const check = publishCheck(saved.doc, store.skillConfig);
		if (check.errors > 0) {
			form.refused = {
				version: number,
				errors: check.errors,
				isWorkingCopy: saved.hash === contentHash($state.snapshot(doc))
			};
			return;
		}
		if (check.warnings > 0 && !anyway) {
			form.confirming = { version: number, warnings: check.warnings };
			return;
		}
		form.busy = true;
		const visibility = visibilityOf(doc);
		try {
			const out = await versions.publish(number, visibility, doc);
			downloadCourse(out, courseFileName(out.name, doc.course_id, `-v${out.version}`));
			form.message = {
				tone: 'ok',
				text: `Verze ${out.version} je zveřejněná (${VISIBILITY_LABEL[visibility].label.toLowerCase()}). Soubor se stáhl — nahraj ho v administraci kurzů.`
			};
		} catch (error) {
			form.message = {
				tone: 'error',
				text: error instanceof Error ? error.message : String(error)
			};
		} finally {
			form.busy = false;
		}
	}

	async function compare(number: number) {
		const published = versions.published;
		if (published === null) return;
		const [a, b] = await Promise.all([versions.get(published.version), versions.get(number)]);
		form.diffs = { ...form.diffs, [number]: a && b ? summariseDiff(a.doc, b.doc) : 'none' };
	}
</script>

<Modal title="Verze kurzu" {onclose} size="l">
	<div class="versions">
		<section class="working">
			<h3 data-screen="{screen}.working.heading">{view.working.heading}</h3>
			<p class="muted" data-screen="{screen}.working.status">{view.working.status}</p>
			<div class="save">
				<input
					type="text"
					value={form.note}
					oninput={(e) => (form.note = e.currentTarget.value)}
					placeholder="Poznámka k verzi (nepovinná)"
					aria-label="Poznámka k verzi"
				/>
				<Button onclick={save} disabled={!view.working.can_save}>
					<History size={16}></History>
					<span data-screen="{screen}.working.save_label">{view.working.save_label}</span>
				</Button>
			</div>
		</section>

		<section>
			<h3>Kdo kurz uvidí</h3>
			<Segmented
				wrap
				explain
				label="Kdo kurz uvidí"
				options={view.visibility.options}
				value={view.visibility.value}
				onchange={(v: Visibility) => store.apply((d) => setVisibility(d, v))}
			/>
			{#if view.visibility.published_note}
				<p class="muted" data-screen="{screen}.visibility.published_note">
					{view.visibility.published_note}
				</p>
			{/if}
		</section>

		{#if view.message}
			<p class="message {view.message.tone}" role="status" data-screen="{screen}.message.text">
				{view.message.text}
			</p>
		{/if}

		<section>
			<h3>Uložené verze</h3>
			{#if view.list_text}
				<p class="muted" data-screen="{screen}.list_text">{view.list_text}</p>
			{:else}
				<ul>
					{#each view.items as item, i (item.version)}
						<li class:current={item.published}>
							<div class="line">
								<strong data-screen="{screen}.items[{i}].name">{item.name}</strong>
								<span class="muted" data-screen="{screen}.items[{i}].saved_at">{item.saved_at}</span
								>
								{#each item.chips as chip, c (c)}
									<Chip tone={chip.tone}>
										<span data-screen="{screen}.items[{i}].chips[{c}].text">{chip.text}</span>
									</Chip>
								{/each}
							</div>
							{#if item.note}<p class="note" data-screen="{screen}.items[{i}].note">
									{item.note}
								</p>{/if}
							{#if item.compare}
								{#if item.compare.offered}
									<button type="button" class="link" onclick={() => compare(item.version)}>
										Co se změnilo oproti zveřejněné?
									</button>
								{:else}
									<p class="muted" data-screen="{screen}.items[{i}].compare.text">
										{item.compare.text}
									</p>
								{/if}
							{/if}
							<div class="actions">
								<Button
									variant="ghost"
									size="s"
									onclick={() => restore(item.version)}
									disabled={view.working.busy}
								>
									<RotateCcw size={14}></RotateCcw>
									Obnovit
								</Button>
								<Button variant="ghost" size="s" onclick={() => download(item.version)}>
									<Download size={14}></Download>
									Stáhnout
								</Button>
								{#if item.publish}
									<Button
										variant="secondary"
										size="s"
										onclick={() => requestPublish(item.version)}
										disabled={view.working.busy}
									>
										<Send size={14}></Send>
										<span data-screen="{screen}.items[{i}].publish.label">{item.publish.label}</span
										>
									</Button>
								{/if}
							</div>
							{#if item.refused_text}
								<p class="message error" role="alert">
									<span data-screen="{screen}.items[{i}].refused_text">{item.refused_text}</span>
									{#if item.refused_is_working_copy}
										<button type="button" class="link" onclick={onreview}>Ukázat, co chybí</button>
									{:else}
										Obnov ji, oprav a ulož jako novou verzi.
									{/if}
								</p>
							{/if}
							{#if item.confirming_text}
								<p class="message warning" role="alert">
									<span data-screen="{screen}.items[{i}].confirming_text"
										>{item.confirming_text}</span
									>
									<button
										type="button"
										class="link"
										onclick={() => requestPublish(item.version, true)}
									>
										Zveřejnit i tak
									</button>
								</p>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<p class="muted kept" data-screen="{screen}.kept">{view.kept}</p>
	</div>
</Modal>

<style>
	.versions {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}

	h3 {
		margin: 0 0 8px;
		font-family: var(--font-heading);
		font-size: var(--text-m);
	}

	.muted {
		margin: 6px 0 0;
		color: var(--e-text-muted);
		font-size: var(--text-s);
	}

	.save {
		display: flex;
		gap: 8px;
		margin-top: 10px;
	}

	.save input {
		flex: 1;
		min-width: 0;
		padding: 8px 10px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-s);
		background: var(--surface);
		color: var(--e-text);
		font: inherit;
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		padding: 10px 12px;
		border: 1px solid var(--e-border);
		border-radius: var(--radius-m);
	}

	li.current {
		border-color: var(--e-ok, var(--primary));
	}

	.line,
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}

	.actions {
		margin-top: 6px;
	}

	.note {
		margin: 4px 0 0;
		font-size: var(--text-s);
	}

	.message {
		margin: 6px 0 0;
		padding: 8px 10px;
		border-radius: var(--radius-s);
		background: var(--info-bg);
		font-size: var(--text-s);
	}

	.message.error {
		color: var(--e-error);
	}

	.message.warning {
		color: var(--e-warning);
	}

	.link {
		padding: 0;
		border: none;
		background: none;
		color: var(--primary);
		font: inherit;
		font-size: var(--text-s);
		text-decoration: underline;
		cursor: pointer;
	}

	.kept {
		margin: 0;
	}
</style>
