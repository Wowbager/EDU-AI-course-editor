import type { Component } from 'svelte';
import {
	ChartPie,
	Info,
	Layers,
	Lightbulb,
	Play,
	Repeat,
	Route,
	SlidersHorizontal,
	Sparkles,
	Target
} from '@lucide/svelte';

/**
 * The icon beside each section's name in a settings dialog's list, by the `icon` key
 * of its `SectionSpec`. The name is always written next to it: an icon here helps the
 * eye find a section again, it is never the only way to know which one it is.
 */
export const SECTION_ICONS: Record<string, Component<{ size?: number; 'aria-hidden'?: 'true' }>> = {
	main: SlidersHorizontal,
	ladder: Lightbulb,
	topics: Target,
	review: Repeat,
	followup: Route,
	lesson: Layers,
	meta: Info,
	didactics: ChartPie,
	ai: Sparkles,
	run: Play
};
