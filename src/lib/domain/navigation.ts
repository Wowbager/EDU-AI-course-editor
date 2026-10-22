import type { BlockV2 } from './schema';

/**
 * Whether the app ignores a `go_to` in this block: only an `exercise` block always
 * goes on to its next step (`step_navigation.dart`, `GoToResolver.resolve`:
 * `if (blockType == BlockType.exercise) return nextStep`). The course's
 * `export_type` plays no part — `ExportMode.exerciseV2` is never consulted, so a
 * `question` card in an `exercise_v2` course branches as in any other course.
 */
export const goToIgnored = (block: BlockV2): boolean => block.type === 'exercise';
