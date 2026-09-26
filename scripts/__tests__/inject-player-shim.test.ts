import { describe, expect, it } from 'vitest';
import { SHIM_END, SHIM_START, injectPlayerShim } from '../inject-player-shim.mjs';

const SAMPLE_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <base href="/player/">
</head>
<body>
  <script src="flutter_bootstrap.js" defer></script>
</body>
</html>
`;

describe('injectPlayerShim', () => {
	it('inserts the shim as the first thing in <head>', () => {
		const result = injectPlayerShim(SAMPLE_HTML, 'console.log("shim");');

		const headIndex = result.indexOf('<head>');
		const shimIndex = result.indexOf(SHIM_START);
		const metaIndex = result.indexOf('<meta charset');
		const bootstrapIndex = result.indexOf('flutter_bootstrap.js');

		expect(headIndex).toBeGreaterThanOrEqual(0);
		expect(shimIndex).toBeGreaterThan(headIndex);
		expect(shimIndex).toBeLessThan(metaIndex);
		expect(shimIndex).toBeLessThan(bootstrapIndex);
		expect(result).toContain('console.log("shim");');
		expect(result).toContain(SHIM_END);
	});

	it('is idempotent: injecting twice yields one shim block, with the latest source', () => {
		const once = injectPlayerShim(SAMPLE_HTML, 'console.log("v1");');
		const twice = injectPlayerShim(once, 'console.log("v2");');

		expect(twice.split(SHIM_START)).toHaveLength(2); // exactly one marker pair
		expect(twice).not.toContain('v1');
		expect(twice).toContain('v2');
	});

	it('throws rather than silently no-op-ing when there is no <head> tag', () => {
		expect(() => injectPlayerShim('<html><body>no head here</body></html>', 'x')).toThrow(
			/no <head> tag/
		);
	});

	it('matches <head> with attributes, case-insensitively', () => {
		const html = '<!DOCTYPE html><HTML><Head lang="en"><title>t</title></Head><body></body></HTML>';
		const result = injectPlayerShim(html, 'x');
		expect(result).toContain(SHIM_START);
		expect(result.indexOf(SHIM_START)).toBeLessThan(result.indexOf('<title>'));
	});

	it('drops scripts from other origins, which can hold up the player\'s boot', () => {
		const html = `<html><head>
  <script type="text/javascript"
    src="https://alcdn.msauth.net/browser/2.13.1/js/msal-browser.min.js"
    integrity="sha384-x" crossorigin="anonymous"></script>
  <script src="assets/packages/aad_oauth/assets/msalv2.js"></script>
</head><body><script src="flutter_bootstrap.js" async></script></body></html>`;
		const result = injectPlayerShim(html, 'x');
		expect(result).not.toContain('<script type="text/javascript"');
		expect(result).toContain('external script dropped: //alcdn.msauth.net/browser/2.13.1/js/msal-browser.min.js');
		// Same-origin scripts stay, and so does the bootstrap.
		expect(result).toContain('<script src="assets/packages/aad_oauth/assets/msalv2.js"></script>');
		expect(result).toContain('<script src="flutter_bootstrap.js" async></script>');
		expect(injectPlayerShim(result, 'x')).toBe(result);
	});
});
