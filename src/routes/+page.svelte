<script lang="ts">
	import { RedactorEngine } from '$lib/RedactorEngine.svelte';
	import { NordicEngine } from '$lib/nordic/NordicEngine.svelte';
	import LoadPanel from '$lib/LoadPanel.svelte';
	import SpecPanel from '$lib/SpecPanel.svelte';
	import type { Span } from '$lib/detectors';

	const fast = new RedactorEngine();
	const nordic = new NordicEngine();
	let mode = $state<'fast' | 'nordic'>('fast');
	const engine = $derived(mode === 'fast' ? fast : nordic);

	$effect(() => {
		engine.start();
	});
	$effect(() => () => {
		fast.stop();
		nordic.stop();
	});

	const SAMPLES: { id: string; name: string; text: string }[] = [
		{
			id: 'no',
			name: 'Norwegian ticket',
			text: 'Hei! Vår ansatte Kari Nordmann (fnr 12038439853) er sykmeldt. Dere når henne på kari.nordmann@fjellkraft.no eller 412 34 567.\nMvh Ola Hansen, HR-leder\nFjellkraft AS · org.nr 987 654 321 · sentralbord 73 90 00 00'
		},
		{
			id: 'sv',
			name: 'Swedish ticket',
			text: 'Hej! Vår anställda Anna Svensson (personnummer 811218-9876) kommer inte in i portalen. Ring 070-123 45 67 eller mejla anna.svensson@nordkraft.se.\nVänligen, Erik Lindqvist\nVäxel: 08-123 45 00'
		}
	];

	let input = $state(SAMPLES[0].text);

	const LABEL_NAMES: Record<Span['label'], string> = {
		person: 'person',
		national_id: 'national id',
		phone: 'phone',
		email: 'e-mail',
		account_number: 'account',
		card: 'card',
		address: 'address',
		date: 'date',
		url: 'url',
		secret: 'secret'
	};

	interface Piece {
		key: number;
		text: string;
		span: Span | null;
	}

	const pieces = $derived.by<Piece[]>(() => {
		const out: Piece[] = [];
		let cursor = 0;
		let key = 0;
		for (const s of engine.spans) {
			if (s.start > cursor) out.push({ key: key++, text: engine.analyzedText.slice(cursor, s.start), span: null });
			out.push({ key: key++, text: engine.analyzedText.slice(s.start, s.end), span: s });
			cursor = s.end;
		}
		if (cursor < engine.analyzedText.length)
			out.push({ key: key++, text: engine.analyzedText.slice(cursor), span: null });
		return out;
	});

	const statusText = $derived(
		engine.status === 'loading'
			? engine.progress || 'loading model…'
			: engine.status === 'ready'
				? `model ready · ${engine.device === 'webgpu' ? 'your GPU (WebGPU)' : 'CPU (WASM)'}`
				: engine.status === 'error'
					? 'model unavailable — checksum and pattern detectors still active'
					: 'starting…'
	);

	function run() {
		void engine.redact(input);
	}
</script>

<svelte:head><title>Redactor in the Browser</title></svelte:head>

<main>
	<p class="eyebrow">in-browser redaction · nothing leaves this machine</p>
	<h1>Redactor in the Browser</h1>
	<p class="lede">
		Personal-data detection running entirely in your browser — the neural model on your own GPU via
		WebGPU (WASM fallback), plus checksum validators for Nordic identifiers. No server sees the text.
	</p>
	<nav class="links">
		<a href="/batch">Batch CSV / Excel →</a>
		<a href="/models">The models →</a>
		<a href="/how-it-works">How it works →</a>
	</nav>

	<div class="engines" role="radiogroup" aria-label="Detection engine">
		<label class={['engchip', { on: mode === 'fast' }]}><input type="radio" bind:group={mode} value="fast" /> nordic-ner · our small model + checksums</label>
		<label class={['engchip', { on: mode === 'nordic' }]}><input type="radio" bind:group={mode} value="nordic" /> nordic-v9 · the real model (~1.9 GB, downloads once)</label>
	</div>

	<div class="status" data-state={engine.status}>{statusText}{#if engine.lastMs !== null}<span class="ms"> · last inference {engine.lastMs} ms</span>{/if}</div>

	{#if engine.status === 'loading'}
		<LoadPanel {engine} />
	{/if}

	{#if engine.status === 'error'}
		<div class="alert" role="alert">
			<p><strong>The neural model could not start.</strong> Checksum and pattern detectors are still running, so structured PII (national IDs, IBAN, cards, e-mail, phones, street addresses) is redacted — but names and free-text PII are not.</p>
			{#if engine.diagnostics.length}
				<ul>
					{#each engine.diagnostics as d, i (i)}<li>{d}</li>{/each}
				</ul>
			{/if}
		</div>
	{/if}

	<SpecPanel {mode} {engine} />

	<div class="samples">
		{#each SAMPLES as s (s.id)}
			<button class="chip" onclick={() => (input = s.text)}>{s.name}</button>
		{/each}
	</div>

	<label for="ticket">Text to redact</label>
	<textarea id="ticket" bind:value={input} rows="7" spellcheck="false"></textarea>
	<button class="go" onclick={run} disabled={engine.busy || engine.status === 'loading'}>
		{engine.status === 'loading' ? 'Loading model…' : engine.busy ? 'Redacting…' : 'Redact'}
	</button>

	{#if engine.analyzedText}
		<section aria-label="Redacted result">
			<h2>Result <span class="count">{engine.spans.length} redaction{engine.spans.length === 1 ? '' : 's'}</span></h2>
			<div class="result">
				{#each pieces as p (p.key)}
					{#if p.span}
						<mark data-label={p.span.label} title="{LABEL_NAMES[p.span.label]} · via {p.span.source}"
							><span class="tag">{LABEL_NAMES[p.span.label]}</span>{p.text}</mark
						>
					{:else}{p.text}{/if}
				{/each}
			</div>
			<p class="hint">
				Hover a bar to see the category and which detector fired. Company org numbers and
				switchboards are deliberately left alone.{#if mode === 'nordic' && nordic.truncated}
					<strong>Input was longer than nordic-v9's 1,024-token window; only the first part was analysed.</strong>{/if}
			</p>
		</section>
	{/if}

	<footer>
		<p>
			<strong>Two engines, both fully in your browser.</strong>
			<span class="mono">Fast demo</span>: <strong><span class="mono">nordic-ner</span>, our own
			135&nbsp;MB model</strong> — DistilBERT-multilingual fine-tuned on the same Nordic data as the
			flagship (blind span-F1 <b>0.95</b>, and <b>0.94</b> on the same tickets lowercased) — plus pattern + checksum
			detectors (fødselsnummer mod-11, personnummer Luhn, IBAN mod-97). Loads in seconds and runs
			fully in your browser: ideal for redacting CSV/Excel exports locally without sending anything out.
		</p>
		<p>
			<strong><span class="mono">nordic-v9</span> is the production model itself</strong> — a custom
			1.4B mixture-of-experts network <strong>fine-tuned from
			<a href="https://huggingface.co/openai/privacy-filter" target="_blank" rel="noopener">OpenAI's
			privacy-filter</a></strong> on Nordic HR/support text, exported to ONNX with int8 expert weights
			(~1.9&nbsp;GB, downloaded once and cached in your browser) and run on your GPU via WebGPU
			(WASM fallback). It agrees with the server model on 99.96% of tokens. Two caveats vs the
			server: spans are decoded greedily here (the server uses Viterbi decoding, slightly cleaner
			boundaries), and input is capped at 1,024 tokens per run.
		</p>
	</footer>
</main>

<style>
	:root {
		--paper: #f2f4f1;
		--card: #ffffff;
		--ink: #171a18;
		--ink-2: #4a544d;
		--ink-3: #79837c;
		--rule: #d8ddd8;
		--accent: #188a4f;
		--accent-soft: #e2f0e7;
		--bar: #171a18;
		--bar-text: #f2f4f1;
	}
	@media (prefers-color-scheme: dark) {
		:root {
			--paper: #151815;
			--card: #1f2420;
			--ink: #e8ece8;
			--ink-2: #aeb8b0;
			--ink-3: #7e8880;
			--rule: #2e352f;
			--accent: #2fa067;
			--accent-soft: #1c3227;
			--bar: #e8ece8;
			--bar-text: #151815;
		}
	}
	:global(body) {
		margin: 0;
		background: var(--paper);
		color: var(--ink);
		font: 16px/1.6 system-ui, sans-serif;
	}
	main {
		max-width: 72ch;
		margin: 0 auto;
		padding: 48px 20px 80px;
	}
	.eyebrow {
		font-family: ui-monospace, monospace;
		font-size: 0.72rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--accent);
		margin: 0;
	}
	h1 {
		margin: 6px 0 0;
		font-size: 2.2rem;
		line-height: 1.1;
		letter-spacing: -0.01em;
	}
	.lede {
		color: var(--ink-2);
		max-width: 58ch;
	}
	.lede a {
		color: var(--accent);
	}
	.links {
		display: flex;
		gap: 16px;
		flex-wrap: wrap;
		margin: 10px 0 2px;
		font-size: 0.9rem;
	}
	.links a {
		color: var(--accent);
		text-decoration: none;
		font-weight: 500;
	}
	.links a:hover {
		text-decoration: underline;
	}
	.engines {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		margin: 12px 0 4px;
	}
	.engchip {
		font-size: 0.82rem;
		padding: 5px 14px;
		border-radius: 999px;
		border: 1px solid var(--rule);
		color: var(--ink-2);
		cursor: pointer;
	}
	.engchip.on {
		border-color: var(--accent);
		background: var(--accent-soft);
		color: var(--accent);
	}
	.engchip input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
	}
	.status {
		display: inline-block;
		font-size: 0.82rem;
		padding: 4px 12px;
		border-radius: 999px;
		border: 1px solid var(--rule);
		background: var(--card);
		color: var(--ink-2);
		margin: 6px 0 18px;
	}
	.status[data-state='ready'] {
		border-color: var(--accent);
		background: var(--accent-soft);
		color: var(--accent);
	}
	.ms {
		color: var(--ink-3);
	}
	.samples {
		display: flex;
		gap: 8px;
		margin-bottom: 10px;
	}
	.chip {
		font-size: 0.8rem;
		padding: 4px 12px;
		border-radius: 999px;
		border: 1px solid var(--rule);
		background: var(--card);
		color: var(--ink-2);
		cursor: pointer;
	}
	.chip:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
	label {
		display: block;
		font-size: 0.78rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ink-3);
		margin-bottom: 6px;
	}
	textarea {
		width: 100%;
		box-sizing: border-box;
		font: 0.9rem/1.7 ui-monospace, monospace;
		background: var(--card);
		color: var(--ink);
		border: 1px solid var(--rule);
		border-radius: 10px;
		padding: 14px 16px;
		resize: vertical;
	}
	textarea:focus-visible,
	button:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.go {
		margin-top: 12px;
		font: 600 0.95rem system-ui, sans-serif;
		padding: 10px 26px;
		border-radius: 999px;
		border: none;
		background: var(--accent);
		color: #fff;
		cursor: pointer;
	}
	.go:disabled {
		opacity: 0.6;
		cursor: wait;
	}
	h2 {
		font-size: 1.15rem;
		margin: 30px 0 10px;
	}
	.count {
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--ink-3);
		margin-left: 8px;
	}
	.result {
		background: var(--card);
		border: 1px solid var(--rule);
		border-radius: 10px;
		padding: 18px 20px;
		font: 0.9rem/2.1 ui-monospace, monospace;
		white-space: pre-wrap;
		word-break: break-word;
	}
	mark {
		background: var(--bar);
		color: var(--bar);
		border-radius: 3px;
		padding: 1px 6px;
		position: relative;
	}
	mark .tag {
		position: absolute;
		left: 0;
		top: -1.05em;
		font: 600 0.56rem system-ui, sans-serif;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--accent);
		white-space: nowrap;
	}
	mark:hover {
		color: var(--bar-text);
	}
	.hint {
		font-size: 0.82rem;
		color: var(--ink-3);
	}
	.alert {
		border: 1px solid var(--rule);
		border-left: 3px solid #b4472e;
		background: var(--card);
		border-radius: 10px;
		padding: 12px 16px;
		margin: 4px 0 14px;
		font-size: 0.86rem;
		color: var(--ink-2);
	}
	.alert p {
		margin: 0;
	}
	.alert ul {
		margin: 8px 0 0;
		padding-left: 18px;
		font-family: ui-monospace, monospace;
		font-size: 0.78rem;
		color: var(--ink-3);
		word-break: break-word;
	}
	footer {
		margin-top: 44px;
		border-top: 1px solid var(--rule);
		padding-top: 14px;
		font-size: 0.86rem;
		color: var(--ink-2);
	}
	.mono {
		font-family: ui-monospace, monospace;
		font-size: 0.94em;
	}
</style>
