import { expect, openEditor, test, type Page } from './fixtures';
import { playerBuilt } from './player-build';
import { button, inspect, player, press, recordMessages, waitForPlayer } from './player';
import { parseCourse } from '../src/lib/domain/document';
import { splitQuestionCards } from '../src/lib/domain/groups';
import { advance, answer, position, startLesson, type SimState } from '../src/lib/domain/simulate';

/**
 * The simulator (`domain/simulate.ts`) mirrors the player's rules by hand, so the only
 * thing that keeps the two honest is playing the same moves in both. Each test scripts a
 * path through one small course, plays it in the real player, and checks that after every
 * move the player is on the step the simulator says, and that the whole sequence of
 * `stepChanged` messages is the simulator's sequence.
 *
 * A move is "press the main button" (Pokračovat, Zkusit znovu — which of them is
 * on screen is the simulator's call, and the player has to agree by having that button)
 * or "answer with this option".
 */

const COURSE = {
	export_type: 'course_v2',
	course_id: 'parity',
	name: 'Zlomky nanečisto',
	lessons: [{ lesson_id: 'L1', name: 'Lekce', blocks: [{ block_id: 'A' }, { block_id: 'Q' }] }],
	blocks: [
		{
			block_id: 'A',
			type: 'display',
			steps: [
				{ id: 's1', type: 'text', content: 'První odstavec úvodu.' },
				{ id: 's2', type: 'text', content: 'Druhý odstavec úvodu.' }
			]
		},
		{
			block_id: 'Q',
			type: 'question',
			steps: [
				{
					id: 's1',
					type: 'question',
					content: 'Které z nich je ovoce?',
					question: {
						type: 'multiple_choice',
						options: [
							{ id: 'a', text: 'Jablko', is_correct: true },
							{ id: 'b', text: 'Auto', go_to: 's3', feedback: 'Auto ovoce není.' }
						]
					}
				},
				{
					id: 's2',
					type: 'question',
					content: 'Je Praha hlavní město?',
					question: {
						type: 'multiple_choice',
						options: [
							{ id: 'a', text: 'Ano', is_correct: true },
							{ id: 'b', text: 'Ne', go_to: 'AGAIN', feedback: 'Ještě jednou.' }
						]
					}
				},
				{
					id: 's3',
					type: 'question',
					content: 'Opravná otázka: kolik je dvakrát dvě?',
					question: {
						type: 'multiple_choice',
						options: [
							{ id: 'a', text: 'Čtyři', is_correct: true, go_to: 'END' },
							{ id: 'b', text: 'Pět' }
						]
					}
				}
			]
		}
	]
};
// What the editor hands the player: the source, with each question its own card.
const doc = splitQuestionCards(parseCourse(COURSE)).doc;

type Move = { advance: true } | { answer: string };
const next: Move = { advance: true };
const pick = (text: string): Move => ({ answer: text });

const PATHS: { name: string; moves: Move[] }[] = [
	{
		name: 'every answer right, straight through',
		moves: [next, next, pick('Jablko'), pick('Ano')]
	},
	{
		name: 'a wrong answer with feedback jumps to the remedial question, END ends the card',
		moves: [next, next, pick('Auto'), next, pick('Čtyři')]
	},
	{
		name: 'a wrong answer on AGAIN is retried on the same step',
		moves: [next, next, pick('Jablko'), pick('Ne'), next, pick('Ano')]
	}
];

/** The simulator's view of a move, applied to its state. */
function simulate(state: SimState, move: Move): SimState {
	if ('advance' in move) return advance(doc, state).state;
	const block = doc.blocks.find((b) => b.block_id === state.blockId)!;
	const step = block.steps[state.stepIndex];
	const option = step.question!.options!.find((o) => o.text === move.answer)!;
	return answer(doc, state, { optionId: option.id }).state;
}

/** The button the player should offer for what the simulator says is on screen. */
const mainButton = (state: SimState) =>
	state.phase === 'await'
		? 'Zkontrolovat'
		: state.phase === 'solution'
			? 'Pokračovat'
			: state.phase === 'retry'
				? 'Zkusit znovu'
				: 'Pokračovat';

/**
 * Press the card's main button. On a step with nothing to answer it is a button of its
 * own. Once a question is answered the player's accessibility layer folds the whole card
 * into one node (the question, its options, the feedback and the check circle), named by
 * all of that text and ending with the circle's own label. So the circle is found as that
 * node and pressed where the circle is, at the card's bottom right corner (24 px padding
 * and a 48 px circle).
 */
async function pressMain(page: Page, label: string) {
	const own = button(page, label);
	if ((await own.count()) > 0) return press(page, own);

	const folded = player(page)
		.getByRole('button', { name: new RegExp(label) })
		.last();
	await folded.waitFor({ state: 'attached' });
	const frame = (await page.locator('iframe').boundingBox())!;
	for (let attempt = 0; attempt < 20; attempt++) {
		const box = (await folded.boundingBox())!;
		const x = box.x + box.width - 48;
		const y = box.y + box.height - 48;
		if (y > frame.y + 8 && y < frame.y + frame.height - 8) return page.mouse.click(x, y);
		await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
		await page.mouse.wheel(0, Math.sign(y - (frame.y + frame.height / 2)) * 200);
		await inspect(page);
	}
	throw new Error(`could not scroll "${label}" into the player frame`);
}

async function openLesson(page: Page) {
	await openEditor(page);
	await page.setInputFiles('input[type=file]', {
		name: 'parity.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(COURSE))
	});
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(page.locator('aside.preview')).toHaveAttribute('data-player', 'ready', {
		timeout: 60_000
	});
	await page.locator('.tree-card').first().click();
	await waitForPlayer(page, { view: 'expanded', blockId: 'A' });
}

test.describe('the simulator and the real player', () => {
	test.skip(!playerBuilt, 'the Flutter web build is not present');
	test.describe.configure({ timeout: 120_000 });

	for (const path of PATHS) {
		test(`walk the same steps: ${path.name}`, async ({ page }) => {
			const log = await recordMessages(page);
			await openLesson(page);
			const mark = log.mark();
			await page.getByRole('radio', { name: 'Vyzkoušet' }).click();

			let state = startLesson(doc, 'L1');
			const expected: string[] = [];
			const note = (s: SimState) => {
				const at = position(doc, s);
				if (at === null) return;
				const key = `${at.blockId}/${at.stepId}/${at.shownStepIds.join(',')}`;
				if (expected.at(-1) !== key) expected.push(key);
			};

			note(state);
			await waitForPlayer(page, { view: 'play', content: 'lesson', ...position(doc, state)! });

			for (const move of path.moves) {
				const label = mainButton(state);
				if ('answer' in move) await press(page, button(page, move.answer));
				await pressMain(page, label);
				state = simulate(state, move);
				note(state);
				const at = position(doc, state);
				if (at !== null) await waitForPlayer(page, { view: 'play', ...at });
			}

			// Whatever the player reported, in order, is what the simulator walked.
			const reported = (
				log.up('stepChanged', mark) as unknown as {
					blockId: string;
					stepId: string;
					shownStepIds: string[];
				}[]
			).map((m) => `${m.blockId}/${m.stepId}/${m.shownStepIds.join(',')}`);
			expect(reported.filter((key, i) => reported[i - 1] !== key)).toEqual(expected);
		});
	}
});
