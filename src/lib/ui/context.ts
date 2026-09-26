import { getContext, setContext } from 'svelte';
import type { DocStore } from '$lib/state/doc-store.svelte';
import type { StepView } from '$lib/state/step-view.svelte';

const KEY = Symbol('edu-editor-store');

export const setStore = (store: DocStore) => setContext(KEY, store);
export const useStore = (): DocStore => getContext(KEY);

const STEP_VIEW = Symbol('edu-editor-step-view');

export const setStepView = (view: StepView) => setContext(STEP_VIEW, view);
export const useStepView = (): StepView => getContext(STEP_VIEW);
