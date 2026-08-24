/// <reference lib="webworker" />
/** nordic-v9 in the browser: onnxruntime-web session + o200k tokenizer + BIOES decode.
 *  Tries WebGPU, falls back to WASM. The model file is fetched with progress reporting. */
import * as ort from 'onnxruntime-web';
import { Tiktoken } from 'js-tiktoken/lite';
import o200k from 'js-tiktoken/ranks/o200k_base';
import { stitchSpans } from './labels';

ort.env.wasm.wasmPaths = '/ort/';

const MODEL_URL: string = (import.meta.env.VITE_MODEL_URL as string || '/models/nordic-v9-web.onnx');
const MAX_TOKENS = 1024;

let session: ort.InferenceSession | null = null;
let enc: Tiktoken | null = null;

let downloadedMb = 0;
const KNOWN_TOTAL_MB = 1845; // nordic-v9-web.onnx + .data — fallback when the host omits Content-Length (e.g. HF redirects)

async function fetchWithProgress(url: string, totalAllMb: number): Promise<Uint8Array | null> {
	const res = await fetch(url);
	if (res.status === 404) return null;
	if (!res.ok || !res.body) throw new Error(`fetch ${url}: ${res.status}`);
	const total = totalAllMb || KNOWN_TOTAL_MB;
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let got = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		got += value.length;
		const mb = downloadedMb + got / 1e6;
		postMessage({
			type: 'progress',
			pct: Math.min(100, Math.round((mb / total) * 100)),
			mb: Math.round(mb)
		});
	}
	downloadedMb += got / 1e6;
	const out = new Uint8Array(got);
	let off = 0;
	for (const c of chunks) {
		out.set(c, off);
		off += c.length;
	}
	return out;
}

async function contentMb(url: string): Promise<number> {
	try {
		const r = await fetch(url, { method: 'HEAD' });
		return r.ok ? Number(r.headers.get('Content-Length') ?? 0) / 1e6 : 0;
	} catch {
		return 0;
	}
}

const CACHE_NAME = 'nordic-v9-model-v1';

/** Cache Storage persists multi-GB across sessions (HTTP cache rejects a 1.8 GB file).
 *  Returns the cached bytes if present, else fetches with progress and stores them. */
async function cachedFetch(url: string, totalMb: number): Promise<Uint8Array | null> {
	let cache: Cache | null = null;
	try {
		cache = await caches.open(CACHE_NAME);
		const hit = await cache.match(url);
		if (hit) {
			downloadedMb += (Number(hit.headers.get('x-size')) || 0) / 1e6;
			postMessage({ type: 'progress', pct: 100, mb: Math.round(downloadedMb) });
			return new Uint8Array(await hit.arrayBuffer());
		}
	} catch {
		/* Cache API unavailable (private mode / quota) — fall through to plain fetch */
	}
	const bytes = await fetchWithProgress(url, totalMb);
	if (bytes && cache) {
		try {
			await cache.put(
				url,
				new Response(bytes.slice().buffer, { headers: { 'x-size': String(bytes.length) } })
			);
		} catch {
			/* over quota — serving from memory this session is fine */
		}
	}
	return bytes;
}

async function load() {
	enc = new Tiktoken(o200k);
	postMessage({ type: 'log', message: 'tokenizer ready' });
	const dataUrl = MODEL_URL + '.data';
	const totalMb = (await contentMb(MODEL_URL)) + (await contentMb(dataUrl));
	const bytes = await cachedFetch(MODEL_URL, totalMb);
	if (!bytes) {
		postMessage({ type: 'error', message: `model not found at ${MODEL_URL}` });
		return;
	}
	const ext = await cachedFetch(dataUrl, totalMb);
	const dataFile = dataUrl.split('/').pop()!;
	postMessage({ type: 'preparing' });
	for (const dev of ['webgpu', 'wasm'] as const) {
		try {
			const t0 = performance.now();
			session = await ort.InferenceSession.create(bytes, {
				executionProviders: [dev],
				graphOptimizationLevel: 'all',
				...(ext ? { externalData: [{ path: dataFile, data: ext }] } : {})
			});
			postMessage({ type: 'ready', device: dev, loadMs: Math.round(performance.now() - t0) });
			return;
		} catch (e) {
			postMessage({ type: 'log', message: `${dev} failed: ${String(e).slice(0, 300)}` });
		}
	}
	postMessage({ type: 'error', message: 'Could not create ONNX session (webgpu/wasm)' });
}

function tokenOffsets(ids: number[]): number[] {
	// offsets[i] = length of decoded text of tokens[0..i)
	const offs = new Array<number>(ids.length + 1);
	offs[0] = 0;
	for (let i = 1; i <= ids.length; i++) offs[i] = enc!.decode(ids.slice(0, i)).length;
	return offs;
}

onmessage = async (e: MessageEvent) => {
	const msg = e.data;
	if (msg.type === 'init') {
		await load();
	} else if (msg.type === 'redact') {
		if (!session || !enc) {
			postMessage({ type: 'result', id: msg.id, spans: [], ms: 0, truncated: false });
			return;
		}
		const text: string = msg.text;
		const allIds = enc.encode(text);
		const ids = allIds.slice(0, MAX_TOKENS);
		const t0 = performance.now();
		const tokens = new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]);
		const out = await session.run({ tokens });
		const logits = out.logits.data as Float32Array;
		const C = out.logits.dims[2];
		const labelIds = new Int32Array(ids.length);
		for (let i = 0; i < ids.length; i++) {
			let best = 0;
			let bestV = -Infinity;
			for (let c = 0; c < C; c++) {
				const v = logits[i * C + c];
				if (v > bestV) {
					bestV = v;
					best = c;
				}
			}
			labelIds[i] = best;
		}
		const offsets = tokenOffsets(ids);
		const spans = stitchSpans(labelIds, offsets, text);
		postMessage({
			type: 'result',
			id: msg.id,
			spans,
			ms: Math.round(performance.now() - t0),
			tokens: ids.length,
			truncated: allIds.length > MAX_TOKENS
		});
	}
};
