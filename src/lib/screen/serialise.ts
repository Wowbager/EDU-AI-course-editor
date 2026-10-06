/**
 * What an AI tool returns for a region: the region itself, as plain JSON, nothing
 * added and nothing left out. A tool never describes the screen in its own words, so
 * what the agent is told is what `store.screen` holds, which is what the components
 * draw.
 */
import type { Screen, ScreenRegion } from './types';

export function screenSlice<R extends ScreenRegion>(screen: Screen, region: R): Screen[R] {
	return JSON.parse(JSON.stringify(screen[region])) as Screen[R];
}
