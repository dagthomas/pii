/// <reference lib="webworker" />
/** Fast-engine worker: runs OUR fine-tuned nordic-ner (DistilBERT multilingual, 135 MB int8)
 *  in the browser via transformers.js. WebGPU first, WASM fallback. Detects all 9 PII types
 *  with char-offset spans; structured IDs are additionally checksum-validated on the main thread. */
import { pipeline, env, type TokenClassificationPipeline } from '@huggingface/transformers';

const MODEL = 'dagthomas/nordic-ner';
/** Pinned to the case-augmented retrain. Pinning also busts the browser's model cache, so a
 *  returning visitor is not left running the previous weights out of Cache Storage. */
const REVISION = '675eb73ca7f42879d66ff3894723d5ec1378909f';
env.allowLocalModels = false; // always fetch from the Hub

/** The backbone is a 512-token DistilBERT and transformers.js silently truncates past it —
 *  in a redaction tool that means the tail of a long ticket comes back un-redacted. Feed it
 *  in windows instead. ~1,000 characters of Nordic prose is comfortably under 512 word pieces. */
const WINDOW_CHARS = 1000;
const WINDOW_OVERLAP = 120; // so an entity straddling a cut is still seen whole in one window


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
				revision: REVISION,
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

interface RawSpan {
	start: number;
	end: number;
	label: DemoLabel;
	source: 'ner';
	score: number;
}

/** Find `surface` at or after `from`, aligned to a word boundary.
 *  Word pieces carry no offsets, so a span is located by searching the text. Without the
 *  boundary check a stray one-piece prediction ("##ss") matches the middle of some unrelated
 *  earlier word and redacts the wrong two characters while leaving the real PII in the clear. */
function locate(
	text: string,
	surface: string,
	pieces: string[],
	from: number
): { start: number; end: number } | null {
	const continuation = pieces[0].startsWith('##');
	const atWordStart = (i: number) => i === 0 || !/[\p{L}\p{N}]/u.test(text[i - 1]);

	const accept = (at: number, len: number) => {
		let start = at;
		// the model started mid-word — grow left to the real word start rather than
		// emitting a fragment
		if (continuation) while (start > 0 && /[\p{L}\p{N}]/u.test(text[start - 1])) start--;
		else if (!atWordStart(at)) return null;
		return { start, end: at + len };
	};

	for (let at = text.indexOf(surface, from); at >= 0; at = text.indexOf(surface, at + 1)) {
		const hit = accept(at, surface.length);
		if (hit) return hit;
	}
	if (pieces.length > 1) {
		const re = new RegExp(
			pieces.map((p) => p.replace(/^##/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'),
			'g'
		);
		re.lastIndex = from;
		for (let m = re.exec(text); m; m = re.exec(text)) {
			const hit = accept(m.index, m[0].length);
			if (hit) return hit;
		}
	}
	return null;
}

/** transformers.js token-classification returns word pieces without char offsets.
 *  Group consecutive B-/I- tokens of one type, rebuild the surface string, and locate it
 *  in the text. Predictions arrive in token order, so one shared cursor advances monotonically
 *  — a per-label cursor let a later entity match an earlier position in the text. */
function mergeSpansFromTokens(
	toks: Tok[],
	text: string,
	offset = 0,
	minScore = 0.5
): RawSpan[] {
	const spans: RawSpan[] = [];
	let cursor = 0;
	let type: string | null = null;
	let pieces: string[] = [];
	let scores: number[] = [];

	const flush = () => {
		if (type && TO_DEMO[type] && pieces.length) {
			// rebuild: "##x" joins without space, otherwise space-separated
			let surface = '';
			for (const p of pieces) surface += p.startsWith('##') ? p.slice(2) : (surface ? ' ' + p : p);
			// A one-character surface is only usable when it is a continuation piece, because
			// locate() then grows it out to the whole word ("##l" -> "asil"). Standing alone it
			// would match some unrelated letter, which is how "hey asil" used to redact one "l".
			const usable = surface.length >= 2 || pieces[0].startsWith('##');
			const hit = usable ? locate(text, surface, pieces, cursor) : null;
			if (hit) {
				spans.push({
					start: offset + hit.start,
					end: offset + hit.end,
					label: TO_DEMO[type],
					source: 'ner',
					score: scores.reduce((a, b) => a + b, 0) / scores.length
				});
				cursor = hit.end;
			}
		}
		type = null;
		pieces = [];
		scores = [];
	};

	for (const t of toks) {
		const name = t.entity ?? 'O';
		if (name === 'O' || t.score < minScore) {
			flush();
			continue;
		}
		const pre = name[0];
		const ty = name.slice(2);
		if (pre === 'B' || ty !== type) {
			flush();
			type = ty;
			pieces = [t.word];
			scores = [t.score];
		} else {
			pieces.push(t.word);
			scores.push(t.score);
		}
	}
	flush();
	return spans;
}

/** Split into overlapping windows, preferring a paragraph / sentence / word boundary. */
function windows(text: string): { text: string; offset: number }[] {
	if (text.length <= WINDOW_CHARS) return [{ text, offset: 0 }];
	const out: { text: string; offset: number }[] = [];
	let at = 0;
	while (at < text.length) {
		let end = Math.min(text.length, at + WINDOW_CHARS);
		if (end < text.length) {
			const slice = text.slice(at, end);
			const cut =
				Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? ')) + 1 ||
				slice.lastIndexOf(' ') + 1;
			if (cut > WINDOW_CHARS / 2) end = at + cut;
		}
		out.push({ text: text.slice(at, end), offset: at });
		if (end >= text.length) break;
		at = Math.max(end - WINDOW_OVERLAP, at + 1);
	}
	return out;
}

/** One full pass over the text (all windows). */
async function pass(text: string, minScore = 0.5): Promise<RawSpan[]> {
	const spans: RawSpan[] = [];
	for (const w of windows(text)) {
		const out = (await ner!(w.text)) as unknown as Tok[];
		spans.push(...mergeSpansFromTokens(out, w.text, w.offset, minScore));
	}
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
		const text: string = m.text;
		const t0 = performance.now();
		// One pass. The model is trained with case augmentation, so lowercase input is in
		// distribution — no truecasing hack, no stopword list, no second inference.
		const spans = await pass(text);

		postMessage({
			type: 'result',
			id: m.id,
			spans,
			ms: Math.round(performance.now() - t0)
		});
	}
};
