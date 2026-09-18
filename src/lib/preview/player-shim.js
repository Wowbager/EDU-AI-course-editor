// @ts-nocheck — plain JavaScript injected verbatim into a foreign page (see the
// comment below); it patches `fetch`/`XMLHttpRequest` in ways TypeScript's DOM
// types are not meant to describe (reassigning `window.fetch`, forwarding
// `arguments` to an overloaded method), and this file is never compiled or type
// checked as part of a build — `checkJs` merely reaches it because it lives under
// `src/`. `scripts/__tests__` and `src/lib/preview/__tests__` still exercise its
// actual behavior at runtime.
/**
 * Injected into the player's `index.html`, before every other script — see
 * `scripts/inject-player-shim.mjs` (production) and `vite-plugin-player.ts` (dev).
 *
 * Plain JavaScript on purpose: this file is not compiled, it is read as text and
 * spliced verbatim into an HTML page the editor does not build. It also must not be
 * a module script (`type="module"`) — module scripts are deferred, and this has to
 * run before Flutter's own bootstrap script, which is exactly why it has to be
 * *first* in `<head>` as a plain, synchronous `<script>`.
 *
 * What it does: the player loads every step/solution image through the Laravel API's
 * `/api/proxy/image?url=<original>` (see `resolveImageUrl` in the app's
 * `lib/core/utils/image_url.dart`), and that proxy 502s for a number of ordinary
 * image hosts. The fix has to live here because the compiled player builds that URL
 * itself, at request time — there is no editor-side hook into it other than
 * intercepting the request. So this rewrites any matching request to the editor's
 * own `/preview-image?url=<original>` (see `src/routes/preview-image/+server.ts`),
 * which tries the original URL directly before falling back to the same proxy.
 *
 * Flutter web does not commit to one request API: `Image.network` normally goes
 * through `dart:html`'s fetch-based HTTP client, while `package:http` (used by
 * `flutter_svg` for `SvgPicture.network`) can go through either `fetch` or
 * `XMLHttpRequest` depending on the Flutter/`package:http` version in the build.
 * Both are patched here so the fix does not depend on guessing which one a given
 * build uses.
 *
 * Safety rule for this whole file: it must be inert for anything it does not
 * recognise, and it must never throw. A shim that breaks every image request is a
 * worse failure than the one bad proxy call it exists to fix.
 */
(function () {
	'use strict';

	/**
	 * If `rawUrl` is a call to the Laravel image proxy (`.../api/proxy/image?url=…`,
	 * absolute or relative, any origin), returns the equivalent same-origin
	 * `/preview-image?url=…` path with the `url` value copied byte-for-byte —
	 * un-decoded, un-re-encoded, exactly as the player wrote it. Returns `null` for
	 * anything else, including anything this can't confidently parse.
	 *
	 * A plain regex on the raw string, deliberately not `new URL(...)` + reserialising:
	 * re-encoding the query string risks changing the percent-encoding (e.g. Dart's
	 * `Uri.encodeComponent` does not escape exactly the same set of characters as the
	 * `URLSearchParams`/`encodeURIComponent` round trip would), and the whole point is
	 * to hand the original `url=` value to `/preview-image` untouched.
	 */
	function rewriteProxyUrl(rawUrl) {
		if (typeof rawUrl !== 'string' || rawUrl.length === 0) return null;
		var match = /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]+)?(\/api\/proxy\/image)\?url=(.+)$/.exec(rawUrl);
		if (!match) return null;
		return '/preview-image?url=' + match[2];
	}

	// ── fetch ──────────────────────────────────────────────────────────────────
	// `Image.network` on Flutter web most commonly loads bytes through `fetch`.
	try {
		var originalFetch = typeof window !== 'undefined' ? window.fetch : undefined;
		if (typeof originalFetch === 'function') {
			window.fetch = function (input, init) {
				try {
					if (typeof input === 'string') {
						var rewritten = rewriteProxyUrl(input);
						if (rewritten !== null) return originalFetch.call(this, rewritten, init);
					} else if (input && typeof input === 'object' && typeof input.url === 'string') {
						// A `URL` or `Request` object. `Request.url` is read-only, so a
						// matching one is rebuilt rather than mutated in place; anything
						// about the original request this can't see (a body, custom
						// headers) is best-effort copied across, but these are GET image
						// requests in practice.
						var rewrittenUrl = rewriteProxyUrl(input.url);
						if (rewrittenUrl !== null) {
							if (typeof Request === 'function' && input instanceof Request) {
								return originalFetch.call(
									this,
									new Request(rewrittenUrl, {
										method: input.method,
										headers: input.headers,
										mode: input.mode,
										credentials: input.credentials,
										cache: input.cache,
										redirect: input.redirect,
										referrer: input.referrer
									}),
									init
								);
							}
							return originalFetch.call(this, rewrittenUrl, init);
						}
					}
				} catch (e) {
					// Fall through to the original call with the original arguments —
					// an unrecognised shape must never break the request it came with.
				}
				return originalFetch.call(this, input, init);
			};
		}
	} catch (e) {
		// Patching fetch itself failed (e.g. it is non-configurable in some embedding).
		// Leave it alone; XMLHttpRequest below is the other half of the coverage.
	}

	// ── XMLHttpRequest ───────────────────────────────────────────────────────────
	// `package:http`'s browser backend (used by `flutter_svg`'s `SvgPicture.network`
	// on some Flutter/package versions) goes through `XMLHttpRequest` instead.
	try {
		var originalOpen =
			typeof XMLHttpRequest !== 'undefined' ? XMLHttpRequest.prototype.open : undefined;
		if (typeof originalOpen === 'function') {
			XMLHttpRequest.prototype.open = function (method, url) {
				var rest = Array.prototype.slice.call(arguments, 2);
				try {
					var rewritten = rewriteProxyUrl(typeof url === 'string' ? url : String(url));
					if (rewritten !== null) {
						return originalOpen.apply(this, [method, rewritten].concat(rest));
					}
				} catch (e) {
					// Fall through and open the original URL unchanged.
				}
				return originalOpen.apply(this, [method, url].concat(rest));
			};
		}
	} catch (e) {
		// Patching XMLHttpRequest failed; fetch above already covers the common case.
	}
})();
