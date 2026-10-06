/**
 * The `preview` region: what the preview column is showing, and whether the player
 * shows it yet.
 *
 * The column draws the real player in an iframe and reports what it learns
 * (`PreviewState`); this says it as one status. `empty` is decided here, from what is
 * open, and not from the player: with no card to show the player would otherwise keep
 * the last card it was sent.
 */
import { cardLabel, lessonLabel } from '$lib/domain/naming';
import type { PreviewRegion, PreviewStatus, ScreenInput } from './types';

export const EMPTY_EXPANDED =
	'Nic není vybráno — vyber kartu v seznamu vlevo, ukáže se tu její náhled.';
export const EMPTY_PLAY = 'Není co zkoušet — kurz zatím nemá lekci, kterou by žák mohl projít.';

export function buildPreview(input: ScreenInput): PreviewRegion {
	const { doc, open, preview } = input;

	let target: PreviewRegion['target'] = { kind: 'none' };
	if (preview.view === 'expanded') {
		if (open.card !== undefined) {
			target = {
				kind: 'card',
				card: cardLabel(doc, open.card, { lessonId: open.lesson?.lesson_id, max: 44 }),
				lesson: open.lesson === undefined ? null : lessonLabel(doc, open.lesson)
			};
		}
	} else {
		const lesson = doc.lessons.find((l) => l.lesson_id === preview.run?.lessonId);
		if (lesson !== undefined) {
			const start = doc.blocks.find((b) => b.block_id === preview.run?.startBlockId);
			target = {
				kind: 'lesson',
				lesson: lessonLabel(doc, lesson),
				start_card:
					start === undefined
						? null
						: cardLabel(doc, start, { lessonId: lesson.lesson_id, max: 44 })
			};
		}
	}

	const booted = preview.boot === 'ready';
	const status: PreviewStatus =
		target.kind === 'none'
			? 'empty'
			: !booted
				? 'not_started'
				: preview.sync === 'player_error'
					? 'player_error'
					: preview.sync === 'in_sync'
						? 'in_sync'
						: 'syncing';
	const failed = preview.boot === 'missing' || preview.boot === 'stalled';

	return {
		view: preview.view,
		status,
		target,
		player_error: status === 'player_error' ? (preview.error ?? '') : null,
		empty_text:
			status !== 'empty' ? null : preview.view === 'expanded' ? EMPTY_EXPANDED : EMPTY_PLAY,
		// Running has no chip: only the two states a teacher has to wait out or act on.
		chip: booted
			? null
			: failed
				? { tone: 'warning', text: 'přehrávač neběží' }
				: preview.boot === 'starting'
					? { tone: 'neutral', text: 'spouští se…' }
					: null,
		fallback: !booted && failed ? (preview.boot as 'missing' | 'stalled') : null,
		player: booted ? 'ready' : failed ? 'failed' : 'starting',
		can_go_back: preview.canGoBack,
		last_completed:
			preview.completed === null
				? null
				: {
						xp: preview.completed.xp,
						score_koef: preview.completed.scoreKoef,
						mark: preview.completed.mark ?? null,
						on_screen: false
					}
	};
}
