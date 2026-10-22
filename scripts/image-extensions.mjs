/**
 * The file extensions that mark an address as a picture. One list, two readers:
 * the paste rule (`src/lib/ui/rich/paste.ts`) decides from it whether a pasted address
 * becomes an image, and the player shim (`src/lib/preview/player-shim.js`, filled in by
 * `inject-player-shim.mjs`) decides from it which requests go through `/preview-image`.
 * Plain `.mjs` so the Docker build, which runs the injector under bare Node, can use it.
 */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'];
