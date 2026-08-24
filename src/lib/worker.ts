/// <reference lib="webworker" />
/** Fast-engine worker: runs OUR fine-tuned nordic-ner (DistilBERT multilingual, 135 MB int8)
 *  in the browser via transformers.js. WebGPU first, WASM fallback. Detects all 9 PII types
 *  with char-offset spans; structured IDs are additionally checksum-validated on the main thread. */
import { pipeline, env, type TokenClassificationPipeline } from '@huggingface/transformers';

const MODEL = 'dagthomas/nordic-ner';
env.allowLocalModels = false; // always fetch from the Hub

type DemoLabel =
	| 'person' | 'phone' | 'email' | 'address' | 'date'
	| 'account_number' | 'national_id' | 'secret' | 'url';

const TO_DEMO: Record<string, DemoLabel> = {
	private_person: 'person',
	private_phone: 'phone',
	private_email: 'email',
	private_address: 'address',
	private_date: 'date',
	account_number: 'account_number',
	national_id: 'national_id',
	secret: 'secret',
	private_url: 'url'
};

let ner: TokenClassificationPipeline | null = null;

async function load() {
	for (const dev of ['webgpu', 'wasm'] as const) {
		try {
			ner = (await pipeline('token-classification', MODEL, {
				device: dev,
				dtype: 'q8',
				progress_callback: (p: unknown) => postMessage({ type: 'progress', info: p })
			})) as TokenClassificationPipeline;
			postMessage({ type: 'ready', device: dev });
			return;
		} catch (e) {
			postMessage({ type: 'log', message: `${dev} failed: ${String(e).slice(0, 200)}` });
		}
	}
	postMessage({ type: 'error', message: 'Could not initialise WebGPU or WASM backend' });
}

interface Tok {
	entity: string; // e.g. "B-private_person"
	word: string; // WordPiece; continuation pieces start with "##"
	score: number;
}

/** transformers.js token-classification returns word pieces without char offsets.
 *  Group consecutive B-/I- tokens of one type, rebuild the surface string, and locate it
 *  in the text (advancing a per-type cursor to disambiguate repeats). */
function mergeSpansFromTokens(toks: Tok[], text: string) {
	const spans: { start: number; end: number; label: DemoLabel; source: 'ner' }[] = [];
	const cursor: Record<string, number> = {};
	let type: string | null = null;
	let pieces: string[] = [];

	const flush = () => {
		if (type && TO_DEMO[type] && pieces.length) {
			// rebuild: "##x" joins without space, otherwise space-separated
			let surface = '';
			for (const p of pieces) surface += p.startsWith('##') ? p.slice(2) : (surface ? ' ' + p : p);
			const from = cursor[type] ?? 0;
			// try exact, then whitespace-flexible match
			let at = text.indexOf(surface, from);
			let len = surface.length;
			if (at < 0 && pieces.length > 1) {
				const re = new RegExp(pieces.map((p) => p.replace(/^##/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'));
				const m = re.exec(text.slice(from));
				if (m) {
					at = from + m.index;
					len = m[0].length;
				}
			}
			if (at >= 0) {
				spans.push({ start: at, end: at + len, label: TO_DEMO[type], source: 'ner' });
				cursor[type] = at + len;
			}
		}
		type = null;
		pieces = [];
	};

	for (const t of toks) {
		const name = t.entity ?? 'O';
		if (name === 'O' || t.score < 0.5) {
			flush();
			continue;
		}
		const pre = name[0];
		const ty = name.slice(2);
		if (pre === 'B' || ty !== type) {
			flush();
			type = ty;
			pieces = [t.word];
		} else {
			pieces.push(t.word);
		}
	}
	flush();
	return spans;
}

onmessage = async (msg: MessageEvent) => {
	const m = msg.data;
	if (m.type === 'init') {
		await load();
	} else if (m.type === 'ner') {
		if (!ner) {
			postMessage({ type: 'result', id: m.id, spans: [], ms: 0 });
			return;
		}
		const t0 = performance.now();
		const out = (await ner(m.text)) as unknown as Tok[];
		postMessage({
			type: 'result',
			id: m.id,
			spans: mergeSpansFromTokens(out, m.text),
			ms: Math.round(performance.now() - t0)
		});
	}
};
