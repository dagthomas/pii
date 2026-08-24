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
			name: 'Norwegian',
			text: 'Hei! Vår ansatte Kari Nordmann (fnr 12038439853) er sykmeldt. Dere når henne på kari.nordmann@fjellkraft.no eller 412 34 567.\nMvh Ola Hansen, HR-leder\nFjellkraft AS · org.nr 987 654 321 · sentralbord 73 90 00 00'
		},
		{
			id: 'sv',
			name: 'Swedish',
			text: 'Hej! Vår anställda Anna Svensson (personnummer 811218-9876) kommer inte in i portalen. Ring 070-123 45 67 eller mejla anna.svensson@nordkraft.se.\nVänligen, Erik Lindqvist\nVäxel: 08-123 45 00'
		},
		{
			id: 'lower',
			name: 'all lower case',
			text: 'hei! kari nordmann er sykmeldt og bor i nedre slottsgate 7b, 0157 oslo. ring truls hagen eller mari lie hansen på 412 34 567.'
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
			if (s.start > cursor)
				out.push({ key: key++, text: engine.analyzedText.slice(cursor, s.start), span: null });
			out.push({ key: key++, text: engine.analyzedText.slice(s.start, s.end), span: s });
			cursor = s.end;
		}
		if (cursor < engine.analyzedText.length)
			out.push({ key: key++, text: engine.analyzedText.slice(cursor), span: null });
		return out;
	});

	const statusText = $derived(
		engine.status === 'loading'
			? engine.progress || 'Loading model…'
			: engine.status === 'ready'
				? `Ready · ${engine.device === 'webgpu' ? 'your GPU (WebGPU)' : 'CPU (WASM)'}`
				: engine.status === 'error'
					? 'Model unavailable — checksum detectors still active'
					: 'Starting…'
	);

	function run() {
		void engine.redact(input);
	}

	/** The redacted text is still in the DOM — it is only painted over, so that hovering a bar
	 *  can reveal it. That means a plain copy would put the real PII on the clipboard, which
	 *  defeats the point of the tool. Rewrite the clipboard payload so every redacted span
	 *  leaves as its <LABEL> placeholder instead. */
	function handleCopy(event: ClipboardEvent) {
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed || !event.clipboardData) return;

		const placeholder = (el: Element) =>
			`<${(el.getAttribute('data-label') ?? 'redacted').toUpperCase()}>`;

		let out = '';
		for (let i = 0; i < selection.rangeCount; i++) {
			const range = selection.getRangeAt(i);
			// A selection that starts AND ends inside one bar clones as bare text with no <mark>
			// around it — that path has to be caught explicitly or it leaks the whole word.
			const node = range.commonAncestorContainer;
			const host = (
				node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
			)?.closest('mark');
			if (host) {
				out += placeholder(host);
				continue;
			}
			const fragment = range.cloneContents();
			// A partially-selected bar still clones as a <mark>, so replacing the element covers
			// partial selections too — never a substring of the real value.
			for (const el of fragment.querySelectorAll('mark')) {
				el.replaceWith(document.createTextNode(placeholder(el)));
			}
			out += fragment.textContent ?? '';
		}

		event.clipboardData.setData('text/plain', out);
		event.preventDefault();
	}
</script>

<svelte:head><title>Redact — Nordic PII</title></svelte:head>

<div class="page">
	<header class="hero">
		<p class="eyebrow">In-browser redaction</p>
		<h1>Find the personal data before it leaves your machine</h1>
		<p class="prose lede">
			Nine kinds of personal data, detected by a neural model running on your own GPU — plus
			checksum validators for Nordic identifiers. Nothing is uploaded.
		</p>
	</header>

	<section class="card engine-card" aria-label="Detection engine">
		<div class="engines" role="radiogroup" aria-label="Choose a model">
			<label class={['chip', { on: mode === 'fast' }]}>
				<input type="radio" bind:group={mode} value="fast" />
				<span class="chip-title">nordic-ner</span>
				<span class="chip-sub">135 MB · loads in seconds</span>
			</label>
			<label class={['chip', { on: mode === 'nordic' }]}>
				<input type="radio" bind:group={mode} value="nordic" />
				<span class="chip-title">nordic-v14</span>
				<span class="chip-sub">1.9 GB · highest accuracy</span>
			</label>
		</div>

		<div class="status" data-state={engine.status}>
			<span class="pulse" aria-hidden="true"></span>
			<span>{statusText}</span>
			{#if engine.lastMs !== null}<span class="ms">{engine.lastMs} ms</span>{/if}
		</div>

		{#if engine.status === 'loading'}
			<LoadPanel {engine} />
		{/if}

		{#if engine.status === 'error'}
			<div class="alert" role="alert">
				<p>
					<strong>The neural model could not start.</strong> Checksum and pattern detectors still run,
					so national IDs, IBANs, cards, e-mail and phones are redacted — names and free text are not.
				</p>
				{#if engine.diagnostics.length}
					<ul>
						{#each engine.diagnostics as d, i (i)}<li>{d}</li>{/each}
					</ul>
				{/if}
			</div>
		{/if}
	</section>

	<section class="field" aria-label="Text to redact">
		<div class="field-head">
			<label for="redact-input">Your text</label>
			<div class="samples">
				{#each SAMPLES as smp (smp.id)}
					<button class="ghost" onclick={() => (input = smp.text)}>{smp.name}</button>
				{/each}
			</div>
		</div>
		<textarea id="redact-input" bind:value={input} rows="7" spellcheck="false"></textarea>
		<div class="actions">
			<button class="primary" onclick={run} disabled={engine.busy || engine.status === 'loading'}>
				{engine.status === 'loading' ? 'Loading model…' : engine.busy ? 'Redacting…' : 'Redact'}
			</button>
			<span class="hint-inline">Runs locally · nothing is sent anywhere</span>
		</div>
	</section>

	{#if engine.analyzedText}
		<section class="field" aria-label="Result">
			<div class="field-head">
				<h2>Result</h2>
				<span class="count"
					>{engine.spans.length} redaction{engine.spans.length === 1 ? '' : 's'}</span
				>
			</div>
			<div class="result card" oncopy={handleCopy}>
				{#each pieces as p (p.key)}
					{#if p.span}
						<mark
							data-label={p.span.label}
							title="{LABEL_NAMES[p.span.label]} · via {p.span.source}"
							><span class="tag">{LABEL_NAMES[p.span.label]}</span>{p.text}</mark
						>
					{:else}{p.text}{/if}
				{/each}
			</div>
			<p class="hint">
				Hover a bar to reveal what is under it. Copying gives you
				<span class="mono">&lt;PERSON&gt;</span> placeholders, never the hidden text. Company org numbers
				and switchboards are deliberately left alone.{#if mode === 'nordic' && nordic.truncated}
					<strong> Input exceeded the 1,024-token window; only the first part was analysed.</strong>
				{/if}
			</p>
		</section>

		<SpecPanel {mode} {engine} />
	{/if}
</div>

<style>
	.hero {
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
		padding-top: var(--s-4);
	}
	.lede {
		font-size: var(--step-1);
	}

	.engine-card,
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
	}

	.engines {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--s-3);
	}
	.chip {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--s-3) var(--s-4);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		cursor: pointer;
		background: var(--surface);
		transition:
			border-color 0.12s ease,
			background-color 0.12s ease;
	}
	.chip:hover {
		border-color: var(--ink-3);
	}
	.chip.on {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.chip-title {
		font-family: var(--font-mono);
		font-size: var(--step-0);
		font-weight: 500;
		color: var(--ink);
	}
	.chip.on .chip-title {
		color: var(--accent);
	}
	.chip-sub {
		font-size: var(--step--1);
		color: var(--ink-3);
	}
	.chip input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
	}

	.status {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		font-size: var(--step--1);
		color: var(--ink-2);
	}
	.pulse {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--ink-3);
		flex: none;
	}
	.status[data-state='ready'] .pulse {
		background: var(--accent);
	}
	.status[data-state='error'] .pulse {
		background: var(--danger);
	}
	.ms {
		margin-left: auto;
		font-family: var(--font-mono);
		color: var(--ink-3);
	}

	.alert {
		border: 1px solid var(--line);
		border-left: 3px solid var(--danger);
		background: var(--danger-soft);
		border-radius: var(--radius);
		padding: var(--s-3) var(--s-4);
		font-size: var(--step--1);
		color: var(--ink-2);
	}
	.alert ul {
		margin: var(--s-2) 0 0;
		padding-left: var(--s-4);
		font-family: var(--font-mono);
		font-size: 0.9em;
		color: var(--ink-3);
		word-break: break-word;
	}

	.field-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--s-3);
		flex-wrap: wrap;
	}
	label {
		font-size: var(--step--1);
		font-weight: 500;
		color: var(--ink-2);
	}
	.samples {
		display: flex;
		gap: var(--s-2);
		flex-wrap: wrap;
	}
	.ghost {
		font: inherit;
		font-size: var(--step--1);
		padding: 4px var(--s-3);
		border-radius: var(--radius-pill);
		border: 1px solid var(--line);
		background: transparent;
		color: var(--ink-3);
		cursor: pointer;
	}
	.ghost:hover {
		color: var(--accent);
		border-color: var(--accent);
	}

	textarea {
		width: 100%;
		font-family: var(--font-mono);
		font-size: var(--step--1);
		line-height: 1.75;
		background: var(--surface);
		color: var(--ink);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: var(--s-4);
		resize: vertical;
	}
	textarea:focus-visible {
		border-color: var(--accent);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: var(--s-4);
		flex-wrap: wrap;
	}
	.primary {
		font: inherit;
		font-weight: 500;
		padding: 10px var(--s-5);
		border-radius: var(--radius-pill);
		border: none;
		background: var(--accent);
		color: var(--accent-ink);
		cursor: pointer;
	}
	.primary:disabled {
		opacity: 0.55;
		cursor: wait;
	}
	.hint-inline {
		font-size: var(--step--1);
		color: var(--ink-3);
	}

	.count {
		font-family: var(--font-mono);
		font-size: var(--step--1);
		color: var(--ink-3);
	}

	.result {
		font-family: var(--font-mono);
		font-size: var(--step--1);
		/* room for the label badge that sits above each bar */
		line-height: 2.9;
		white-space: pre-wrap;
		word-break: break-word;
	}
	mark {
		background: var(--redact-bar);
		color: transparent;
		border-radius: 4px;
		padding: 2px 6px;
		position: relative;
		box-shadow: 0 0 0 1px var(--redact-edge);
	}
	/* The classifier is the point of the whole result — it says WHY something was hidden.
	   A solid badge in the label's own colour, not tinted text, so it stays legible on
	   either ground. */
	mark .tag {
		position: absolute;
		left: 0;
		bottom: calc(100% + 3px);
		display: inline-block;
		padding: 2px 6px;
		border-radius: 5px;
		background: var(--accent);
		color: var(--accent-ink);
		font-family: var(--font-sans);
		font-size: 0.66rem;
		font-weight: 700;
		line-height: 1.25;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		white-space: nowrap;
	}
	mark:hover {
		color: var(--paper);
	}

	.hint {
		font-size: var(--step--1);
		color: var(--ink-3);
		max-width: var(--measure);
	}

	@media (max-width: 560px) {
		.engines {
			grid-template-columns: 1fr;
		}
	}
</style>
