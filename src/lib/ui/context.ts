import { getContext, setContext } from 'svelte';
import type { DocStore } from '$lib/state/doc-store.svelte';

const KEY = Symbol('edu-editor-store');

export const setStore = (store: DocStore) => setContext(KEY, store);
export const useStore = (): DocStore => getContext(KEY);
