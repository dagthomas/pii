/** Client-side engine: owns the worker, exposes reactive state (Svelte 5 class + $state). */
import { detectStructured, mergeSpans, type Span } from './detectors';

/** Words that are capitalized in ticket prose but are not name parts. */
const NAME_STOPWORDS = new Set([
	'hei', 'hej', 'hi', 'hello', 'heisann', 'mvh', 'hilsen', 'takk', 'tack', 'ring',
	'kontakt', 'fra', 'til', 'med', 'og', 'och', 'dear', 'ansatt', 'ansatte', 'vår',
	'vårt', 'deres', 'kjære', 'best', 'kind', 'regards', 'vennlig', 'venleg'
]);

const NAME_WORD = /^[A-ZÆØÅÄÖÜÉ][A-Za-zÀ-ÿ'’.-]+$/;

/** Small NER models often drop a name part that doubles as a common word
 *  ("Dag" = "day") — extend a detected name over adjacent capitalized words. */
function expandName(text: string, start: number, end: number): [number, number] {
	for (let hops = 0; hops < 2; hops++) {
		const before = text.slice(Math.max(0, start - 40), start);
		const m = /([A-ZÆØÅÄÖÜÉ][A-Za-zÀ-ÿ'’.-]+) $/.exec(before);
		if (!m || NAME_STOPWORDS.has(m[1].toLowerCase())) break;
		start -= m[1].length + 1;
	}
	for (let hops = 0; hops < 2; hops++) {
		const after = text.slice(end, end + 40);
		const m = /^ ([A-ZÆØÅÄÖÜÉ][A-Za-zÀ-ÿ'’.-]+)/.exec(after);
		if (!m || !NAME_WORD.test(m[1]) || NAME_STOPWORDS.has(m[1].toLowerCase())) break;
		end += m[1].length + 1;
	}
	return [start, end];
}

export class RedactorEngine {
	status = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	device = $state<'webgpu' | 'wasm' | null>(null);
	progress = $state('');
	busy = $state(false);
	lastMs = $state<number | null>(null);
	spans = $state.raw<Span[]>([]);
	analyzedText = $state('');

	#worker: Worker | null = null;
	#reqId = 0;
	#resolve: ((names: string[]) => void) | null = null;

	start() {
		if (this.#worker) return;
		this.status = 'loading';
		this.#worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
		this.#worker.onmessage = (e: MessageEvent) => {
			const m = e.data;
			if (m.type === 'progress' && m.info?.status === 'progress' && m.info?.file?.endsWith('.onnx')) {
				this.progress = `downloading model ${Math.round(m.info.progress ?? 0)}%`;
			} else if (m.type === 'ready') {
				this.status = 'ready';
				this.device = m.device;
				this.progress = '';
			} else if (m.type === 'error') {
				this.status = 'error';
				this.progress = m.message;
			} else if (m.type === 'result') {
				this.lastMs = m.ms;
				this.#resolve?.(m.names);
				this.#resolve = null;
			}
		};
		this.#worker.postMessage({ type: 'init' });
	}

	stop() {
		this.#worker?.terminate();
		this.#worker = null;
		this.status = 'idle';
	}

	/** Redact one string and return it with <LABEL> placeholders — no page state touched.
	 *  Callers must serialize calls (await each before the next). */
	async redactText(text: string, useNer = true): Promise<string> {
		const spans = await this.#detect(text, useNer);
		let out = '';
		let cursor = 0;
		for (const s of spans) {
			out += text.slice(cursor, s.start) + `<${s.label.toUpperCase()}>`;
			cursor = s.end;
		}
		return out + text.slice(cursor);
	}

	async #detect(text: string, useNer = true): Promise<Span[]> {
		const structured = detectStructured(text);
		let names: string[] = [];
		if (useNer && this.status === 'ready' && this.#worker) {
			names = await new Promise<string[]>((resolve) => {
				this.#resolve = resolve;
				this.#worker!.postMessage({ type: 'ner', id: ++this.#reqId, text });
			});
		}
		const nerSpans: Span[] = [];
		for (const name of names) {
			let i = 0;
			while (true) {
				const at = text.indexOf(name, i);
				if (at < 0) break;
				const [s, e] = expandName(text, at, at + name.length);
				nerSpans.push({ start: s, end: e, label: 'person', source: 'ner' });
				i = at + 1;
			}
		}
		return mergeSpans([...structured, ...nerSpans]);
	}

	async redact(text: string): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		try {
			this.spans = await this.#detect(text);
			this.analyzedText = text;
		} finally {
			this.busy = false;
		}
	}
}
