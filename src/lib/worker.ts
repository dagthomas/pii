/// <reference lib="webworker" />
/** Inference worker: runs a multilingual NER model in the browser via transformers.js.
 *  Tries WebGPU first, falls back to WASM. Only person entities are used —
 *  structured PII (IDs, phones, e-mails) is handled by checksum detectors on the main thread. */
import { pipeline, type TokenClassificationPipeline } from '@huggingface/transformers';

const MODEL = 'Xenova/distilbert-base-multilingual-cased-ner-hrl';

let ner: TokenClassificationPipeline | null = null;
let device: 'webgpu' | 'wasm' = 'webgpu';

async function load() {
	for (const dev of ['webgpu', 'wasm'] as const) {
		try {
			ner = (await pipeline('token-classification', MODEL, {
				device: dev,
				dtype: 'q8',
				progress_callback: (p: unknown) => postMessage({ type: 'progress', info: p })
			})) as TokenClassificationPipeline;
			device = dev;
			postMessage({ type: 'ready', device });
			return;
		} catch (e) {
			postMessage({ type: 'log', message: `${dev} failed: ${String(e)}` });
		}
	}
	postMessage({ type: 'error', message: 'Could not initialise WebGPU or WASM backend' });
}

/** Merge B-/I- word-piece tokens into whole person names. */
function mergePersons(tokens: { entity: string; word: string; score: number }[]): string[] {
	const names: string[] = [];
	let current = '';
	for (const t of tokens) {
		const isPer = t.entity.endsWith('PER') && t.score > 0.5;
		if (!isPer) {
			if (current) names.push(current);
			current = '';
			continue;
		}
		if (t.word.startsWith('##')) current += t.word.slice(2);
		else if (t.entity.startsWith('B') && current) {
			names.push(current);
			current = t.word;
		} else current = current ? `${current} ${t.word}` : t.word;
	}
	if (current) names.push(current);
	return names.filter((n) => n.length > 1);
}

onmessage = async (e: MessageEvent) => {
	const msg = e.data;
	if (msg.type === 'init') {
		await load();
	} else if (msg.type === 'ner') {
		if (!ner) {
			postMessage({ type: 'result', id: msg.id, names: [], ms: 0 });
			return;
		}
		const t0 = performance.now();
		const out = (await ner(msg.text)) as unknown as {
			entity: string;
			word: string;
			score: number;
		}[];
		postMessage({
			type: 'result',
			id: msg.id,
			names: mergePersons(out),
			ms: Math.round(performance.now() - t0)
		});
	}
};
