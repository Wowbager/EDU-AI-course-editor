/**
 * A deep copy of a piece of the course document.
 *
 * The document is JSON by definition, so a JSON round trip is the whole contract.
 * `structuredClone` is not used for it: the editor passes commands the Svelte `$state`
 * proxy, and `structuredClone` throws "could not be cloned" on any Proxy — which made
 * "Duplikovat krok" silently do nothing. A command must never depend on whether it was
 * handed a plain object or a reactive one.
 */
export function deepCopy<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}
