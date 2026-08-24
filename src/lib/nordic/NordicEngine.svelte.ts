/** The real nordic-v9 model, in-browser via onnxruntime-web. Same surface as RedactorEngine. */
import type { Span } from '../detectors';

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
		this.#worker.onmessage = (e: MessageEvent) => {
			const m = e.data;
			if (m.type === 'progress') {
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
				this.status = 'error';
				this.progress = m.message;
			} else if (m.type === 'result') {
				this.lastMs = m.ms;
				this.lastTokens = m.tokens ?? null;
				this.#resolve?.(m.spans);
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

	async #run(text: string): Promise<Span[]> {
		if (this.status !== 'ready' || !this.#worker) return [];
		return new Promise<Span[]>((resolve) => {
			this.#resolve = resolve;
			this.#worker!.postMessage({ type: 'redact', id: ++this.#reqId, text });
		});
	}

	async redact(text: string): Promise<void> {
		if (this.busy || this.status !== 'ready') return; // never render a fake empty result
		this.busy = true;
		try {
			this.spans = await this.#run(text);
			this.analyzedText = text;
		} finally {
			this.busy = false;
		}
	}

	async redactText(text: string, _useNer = true): Promise<string> {
		const spans = await this.#run(text);
		let out = '';
		let cursor = 0;
		for (const s of spans) {
			out += text.slice(cursor, s.start) + `<${s.label.toUpperCase()}>`;
			cursor = s.end;
		}
		return out + text.slice(cursor);
	}
}
