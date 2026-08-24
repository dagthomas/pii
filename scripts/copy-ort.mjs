/** Copy the onnxruntime-web runtime files into static/ort/.
 *
 *  worker-nordic.ts sets `ort.env.wasm.wasmPaths = '/ort/'`, which makes ORT load BOTH the
 *  .wasm binary AND its emscripten .mjs loader from that directory. Shipping only the .wasm
 *  files leaves the .mjs 404-ing, and ORT reports it as "no available backend found" — the
 *  model downloads in full and then silently refuses to run. Keep the two in lockstep by
 *  copying them straight out of node_modules on every build.
 */
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', 'onnxruntime-web', 'dist');
const to = join(root, 'static', 'ort');

mkdirSync(to, { recursive: true });

const files = readdirSync(from).filter((f) => /^ort-wasm-.*\.(wasm|mjs)$/.test(f));
if (files.length === 0) {
	console.error('copy-ort: no ort-wasm-* files in %s — is onnxruntime-web installed?', from);
	process.exit(1);
}
for (const f of files) copyFileSync(join(from, f), join(to, f));

const mjs = files.filter((f) => f.endsWith('.mjs')).length;
console.log(`copy-ort: ${files.length} files -> static/ort (${mjs} .mjs loaders, ${files.length - mjs} .wasm)`);
