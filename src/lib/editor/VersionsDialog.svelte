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
	 */
	import Modal from '$lib/ui/Modal.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Chip from '$lib/ui/Chip.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import { useStore, useVersions } from '$lib/ui/context';
	import { restoreVersion, setVisibility } from '$lib/domain/commands';
	import { validate } from '$lib/domain/validate';
	import {
		ALL_VISIBILITIES,
		TEACHER_VISIBILITIES,
		VISIBILITY_LABEL,
		contentHash,
		publishPlan,
		summariseDiff,
		visibilityOf,
		type DiffSummary,
		type Visibility
	} from '$lib/domain/versions';
	import { courseFileName } from '$lib/domain/filename';
	import { downloadCourse } from '$lib/ui/download';
	import { counted, errorsCount, warningsCount } from '$lib/ui/plural';
	import { Download, History, RotateCcw, Send } from '@lucide/svelte';
	import type { ListedVersion } from '$lib/state/versions/version-store.svelte';

	interface Props {
		onclose: () => void;
		/** Opens the export review, for a version that is the working copy. */
		onreview: () => void;
	}
	let { onclose, onreview }: Props = $props();

	const store = useStore();
	const versions = useVersions();

	const doc = $derived(store.doc);
	const next = $derived(versions.next(doc));
	const modified = $derived(versions.modified(doc));
	const visibility = $derived(visibilityOf(doc));
	const choices = $derived(store.mode === 'teacher' ? TEACHER_VISIBILITIES : ALL_VISIBILITIES);
	const published = $derived(versions.published);
	const newestFirst = $derived([...versions.versions].reverse());

	let note = $state('');
	let busy = $state(false);
	let message = $state<{ tone: 'ok' | 'error'; text: string } | null>(null);
	/** A publication waiting for "i tak" because the version has warnings. */
	let confirming = $state<{ version: number; warnings: number } | null>(null);
	/** A version that cannot go out, and why. */
	let refused = $state<{ version: number; errors: number; isWorkingCopy: boolean } | null>(null);
	let diffs = $state<Record<number, DiffSummary | 'none'>>({});

	const formatter = new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' });
	const when = (iso: string) => formatter.format(new Date(iso));

	async function save() {
		busy = true;
		message = null;
		try {
			const saved = await versions.save(doc, note);
			note = '';
			message = { tone: 'ok', text: `Uloženo jako verze ${saved.version}.` };
		} catch (error) {
			message = { tone: 'error', text: error instanceof Error ? error.message : String(error) };
		} finally {
			busy = false;
		}
	}

	async function restore(version: ListedVersion) {
		if (
			versions.modified(doc) &&
			!window.confirm(
				`Rozpracované změny se nahradí verzí ${version.version}. Vrátit to půjde tlačítkem Zpět.`
			)
		)
			return;
		const saved = await versions.get(version.version);
		if (saved === null) {
			message = { tone: 'error', text: `Verzi ${version.version} se nepodařilo načíst.` };
			return;
		}
		store.apply((d) => restoreVersion(d, saved.doc, version.version));
		message = { tone: 'ok', text: `Rozpracovaná verze je teď obsah verze ${version.version}.` };
	}

	async function download(version: ListedVersion) {
		const saved = await versions.get(version.version);
		if (saved === null) return;
		downloadCourse(saved.doc, courseFileName(saved.doc.name, doc.course_id, `-v${version.version}`));
	}

	/** Check the version, then publish it — or say what stands in the way. */
	async function requestPublish(version: ListedVersion, anyway = false) {
		refused = null;
		confirming = null;
		const saved = await versions.get(version.version);
		if (saved === null) return;
		const result = validate(saved.doc, store.skillConfig);
		if (result.errors.length > 0) {
			refused = {
				version: version.version,
				errors: result.errors.length,
				isWorkingCopy: saved.hash === contentHash($state.snapshot(doc))
			};
			return;
		}
		if (result.warnings.length > 0 && !anyway) {
			confirming = { version: version.version, warnings: result.warnings.length };
			return;
		}
		busy = true;
		try {
			const out = await versions.publish(version.version, visibility, doc);
			downloadCourse(out, courseFileName(out.name, doc.course_id, `-v${out.version}`));
			message = {
				tone: 'ok',
				text: `Verze ${out.version} je zveřejněná (${VISIBILITY_LABEL[visibility].label.toLowerCase()}). Soubor se stáhl — nahraj ho v administraci kurzů.`
			};
		} catch (error) {
			message = { tone: 'error', text: error instanceof Error ? error.message : String(error) };
		} finally {
			busy = false;
		}
	}

	function publishLabel(version: ListedVersion): string {
		const plan = publishPlan(versions.index, version.version, doc);
		return plan.kind === 'publish' ? 'Zveřejnit' : `Zveřejnit znovu jako verzi ${plan.version}`;
	}

	async function compare(version: ListedVersion) {
		if (published === null) return;
		const [a, b] = await Promise.all([versions.get(published.version), versions.get(version.version)]);
		diffs = { ...diffs, [version.version]: a && b ? summariseDiff(a.doc, b.doc) : 'none' };
	}

	function describe(diff: DiffSummary): string {
		const parts = [
			diff.added > 0 ? `nové: ${counted(diff.added, 'karta', 'karty', 'karet')}` : '',
			diff.removed > 0 ? `odebrané: ${counted(diff.removed, 'karta', 'karty', 'karet')}` : '',
			diff.changed > 0 ? `upravené: ${counted(diff.changed, 'karta', 'karty', 'karet')}` : '',
			diff.lessonsChanged ? 'změněné lekce' : ''
		].filter((p) => p !== '');
		return parts.length === 0 ? 'stejné jako zveřejněná verze' : parts.join(', ');
	}

	const kept = $derived.by(() => {
		if (versions.unavailable.length === 0) return 'Verze se ukládají v tomto prohlížeči.';
		return 'Verze se teď nedaří uložit v tomto prohlížeči — historie platí jen do zavření stránky. Stáhni si důležité verze do souboru.';
	});
</script>

<Modal title="Verze kurzu" {onclose} size="l">
	<div class="versions">
		<section class="working">
			<h3>Rozpracovaná verze {next}</h3>
			{#if versions.latest === undefined}
				<p class="muted">Kurz zatím nemá uloženou žádnou verzi.</p>
			{:else if modified}
				<p class="muted">Od verze {versions.latest.version} je kurz upravený.</p>
			{:else}
				<p class="muted">Beze změn od verze {versions.latest.version}.</p>
			{/if}
			<div class="save">
				<input
					type="text"
					bind:value={note}
					placeholder="Poznámka k verzi (nepovinná)"
					aria-label="Poznámka k verzi"
				/>
				<Button onclick={save} disabled={busy || !modified}>
					<History size={16}></History>
					Uložit jako verzi {next}
				</Button>
			</div>
		</section>

		<section>
			<h3>Kdo kurz uvidí</h3>
			<Segmented
				wrap
				label="Kdo kurz uvidí"
				options={choices.map((v) => ({ value: v, ...VISIBILITY_LABEL[v] }))}
				value={visibility}
				onchange={(v: Visibility) => store.apply((d) => setVisibility(d, v))}
			/>
			<p class="muted">{VISIBILITY_LABEL[visibility].title}</p>
			{#if published !== null && published.visibility !== visibility}
				<p class="muted">
					Zveřejněná verze {published.version} je zatím „{VISIBILITY_LABEL[published.visibility].label}“.
					Nové nastavení platí od příštího zveřejnění.
				</p>
			{/if}
		</section>

		{#if message}
			<p class="message {message.tone}" role="status">{message.text}</p>
		{/if}

		<section>
			<h3>Uložené verze</h3>
			{#if versions.loading}
				<p class="muted">Načítám…</p>
			{:else if newestFirst.length === 0}
				<p class="muted">Až verzi uložíš, objeví se tady.</p>
			{:else}
				<ul>
					{#each newestFirst as version (version.version)}
						<li class:current={published?.version === version.version}>
							<div class="line">
								<strong>Verze {version.version}</strong>
								<span class="muted">{when(version.savedAt)}</span>
								{#if published?.version === version.version}
									<Chip tone="ok">Zveřejněná · {VISIBILITY_LABEL[published.visibility].label}</Chip>
								{/if}
								{#if version.origin === 'import'}<Chip tone="quiet">ze souboru</Chip>{/if}
								{#if version.restoredFrom !== undefined}
									<Chip tone="quiet">z verze {version.restoredFrom}</Chip>
								{/if}
							</div>
							{#if version.note}<p class="note">{version.note}</p>{/if}
							{#if store.mode !== 'teacher' && published !== null && published.version !== version.version}
								{@const diff = diffs[version.version]}
								{#if diff === undefined}
									<button type="button" class="link" onclick={() => compare(version)}>
										Co se změnilo oproti zveřejněné?
									</button>
								{:else}
									<p class="muted">{diff === 'none' ? 'Nelze porovnat.' : describe(diff)}</p>
								{/if}
							{/if}
							<div class="actions">
								<Button variant="ghost" size="s" onclick={() => restore(version)} disabled={busy}>
									<RotateCcw size={14}></RotateCcw>
									Obnovit
								</Button>
								<Button variant="ghost" size="s" onclick={() => download(version)}>
									<Download size={14}></Download>
									Stáhnout
								</Button>
								<!-- The version that is out has nothing to publish unless who sees it changed. -->
								{#if published?.version !== version.version || published.visibility !== visibility}
									<Button
										variant="secondary"
										size="s"
										onclick={() => requestPublish(version)}
										disabled={busy}
									>
										<Send size={14}></Send>
										{publishLabel(version)}
									</Button>
								{/if}
							</div>
							{#if refused?.version === version.version}
								<p class="message error" role="alert">
									Verze {version.version} má {errorsCount(refused.errors)}, které žákovi
									rozbijí kurz, a tak ji nejde zveřejnit.
									{#if refused.isWorkingCopy}
										<button type="button" class="link" onclick={onreview}>Ukázat, co chybí</button>
									{:else}
										Obnov ji, oprav a ulož jako novou verzi.
									{/if}
								</p>
							{/if}
							{#if confirming?.version === version.version}
								<p class="message warning" role="alert">
									Verze {version.version} má {warningsCount(confirming.warnings)}.
									<button type="button" class="link" onclick={() => requestPublish(version, true)}>
										Zveřejnit i tak
									</button>
								</p>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<p class="muted kept">{kept}</p>
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
