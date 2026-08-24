/** Client-side engine: owns the worker, exposes reactive state (Svelte 5 class + $state). */
import { detectStructured, mergeSpans, type Span } from './detectors';

export class RedactorEngine {
	status = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	device = $state<'webgpu' | 'wasm' | null>(null);
	progress = $state('');
	busy = $state(false);
	lastMs = $state<number | null>(null);
	/** Set when the last run needed a second, truecased inference pass (lowercase input). */
	caseBoosted = $state(false);
	diagnostics = $state.raw<string[]>([]);
	spans = $state.raw<Span[]>([]);
	analyzedText = $state('');

	#worker: Worker | null = null;
	#reqId = 0;
	#resolve: ((spans: Span[]) => void) | null = null;

	start() {
		if (this.#worker) return;
		this.status = 'loading';
		this.#worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
		this.#worker.onerror = (e) => this.#fail(`worker crashed: ${e.message}`);
		this.#worker.onmessage = (e: MessageEvent) => {
			const m = e.data;
			if (m.type === 'log') {
				this.diagnostics = [...this.diagnostics, String(m.message)];
			} else if (m.type === 'progress' && m.info?.status === 'progress' && m.info?.file?.endsWith('.onnx')) {
				this.progress = `downloading model ${Math.round(m.info.progress ?? 0)}%`;
			} else if (m.type === 'ready') {
				this.status = 'ready';
				this.device = m.device;
				this.progress = '';
			} else if (m.type === 'error') {
				this.#fail(m.message);
			} else if (m.type === 'result') {
				this.lastMs = m.ms;
				this.caseBoosted = !!m.caseBoosted;
				this.#resolve?.(m.spans as Span[]);
				this.#resolve = null;
			}
		};
		this.#worker.postMessage({ type: 'init' });
	}

	/** Enter the error state and release anything waiting on the worker, so the UI
	 *  can never be left stuck on "Redacting…" with no explanation. */
	#fail(message: string) {
		this.status = 'error';
		this.progress = message;
		this.diagnostics = [...this.diagnostics, message];
		this.#resolve?.([]);
		this.#resolve = null;
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
		let nerSpans: Span[] = [];
		if (useNer && this.status === 'ready' && this.#worker) {
			nerSpans = await new Promise<Span[]>((resolve) => {
				this.#resolve = resolve;
				this.#worker!.postMessage({ type: 'ner', id: ++this.#reqId, text });
			});
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
