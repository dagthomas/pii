/** The real nordic-v9 model, in-browser via onnxruntime-web. Same surface as RedactorEngine. */
import { detectStructured, mergeSpans, type Span } from '../detectors';

export class NordicEngine {
	status = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	device = $state<'webgpu' | 'wasm' | null>(null);
	progress = $state('');
	pct = $state<number | null>(null);
	mb = $state<number | null>(null);
	phase = $state<'download' | 'prepare' | null>(null);
	busy = $state(false);
	lastMs = $state<number | null>(null);
	lastTokens = $state<number | null>(null);
	loadMs = $state<number | null>(null);
	truncated = $state(false);
	/** Why the model is unavailable — the backend errors that used to be swallowed. */
	diagnostics = $state.raw<string[]>([]);
	spans = $state.raw<Span[]>([]);
	analyzedText = $state('');

	#worker: Worker | null = null;
	#reqId = 0;
	#resolve: ((spans: Span[]) => void) | null = null;

	start() {
		if (this.#worker) return;
		this.status = 'loading';
		this.progress = 'starting…';
		this.#worker = new Worker(new URL('./worker-nordic.ts', import.meta.url), { type: 'module' });
		this.#worker.onerror = (e) => this.#fail(`worker crashed: ${e.message}`);
		this.#worker.onmessage = (e: MessageEvent) => {
			const m = e.data;
			if (m.type === 'log') {
				this.diagnostics = [...this.diagnostics, String(m.message)];
			} else if (m.type === 'progress') {
				this.phase = 'download';
				this.pct = m.pct;
				this.mb = m.mb;
				this.progress = `downloading nordic-v9 · ${m.pct}% (${m.mb} MB)`;
			} else if (m.type === 'preparing') {
				this.phase = 'prepare';
				this.pct = null;
			} else if (m.type === 'ready') {
				this.status = 'ready';
				this.device = m.device;
				this.loadMs = m.loadMs ?? null;
				this.progress = '';
				this.phase = null;
			} else if (m.type === 'error') {
				this.#fail(m.message);
			} else if (m.type === 'result') {
				this.lastMs = m.ms;
				this.lastTokens = m.tokens ?? null;
				this.truncated = !!m.truncated;
				this.#resolve?.(m.spans);
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
		this.phase = null;
		this.diagnostics = [...this.diagnostics, message];
		this.#resolve?.([]);
		this.#resolve = null;
	}

	stop() {
		this.#worker?.terminate();
		this.#worker = null;
		this.status = 'idle';
	}

	async #model(text: string): Promise<Span[]> {
		if (this.status !== 'ready' || !this.#worker) return [];
		return new Promise<Span[]>((resolve) => {
			this.#resolve = resolve;
			this.#worker!.postMessage({ type: 'redact', id: ++this.#reqId, text });
		});
	}

	/** Checksum + pattern detectors always run; the model adds names and free-text PII
	 *  when it is up. If it is not, the run still redacts what can be proven. */
	async #detect(text: string): Promise<Span[]> {
		const structured = detectStructured(text);
		const model = await this.#model(text);
		return mergeSpans([...structured, ...model]);
	}

	async redact(text: string): Promise<void> {
		if (this.busy || this.status === 'loading') return;
		this.busy = true;
		try {
			this.spans = await this.#detect(text);
			this.analyzedText = text;
		} finally {
			this.busy = false;
		}
	}

	async redactText(text: string, _useNer = true): Promise<string> {
		const spans = await this.#detect(text);
		let out = '';
		let cursor = 0;
		for (const s of spans) {
			out += text.slice(cursor, s.start) + `<${s.label.toUpperCase()}>`;
			cursor = s.end;
		}
		return out + text.slice(cursor);
	}
}
