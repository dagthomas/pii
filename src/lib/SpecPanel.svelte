<script lang="ts">
	interface EngineLike {
		device?: 'webgpu' | 'wasm' | null;
		lastMs?: number | null;
		lastTokens?: number | null;
		loadMs?: number | null;
		status?: string;
	}
	interface Props {
		mode: 'fast' | 'nordic';
		engine: EngineLike;
	}
	let { mode, engine }: Props = $props();

	const isNordic = $derived(mode === 'nordic');
	const deviceLabel = $derived(
		engine.device === 'webgpu' ? 'WebGPU (your GPU)' : engine.device === 'wasm' ? 'WASM (CPU)' : '—'
	);
	const throughput = $derived(
		engine.lastMs && engine.lastTokens ? Math.round((engine.lastTokens / engine.lastMs) * 1000) : null
	);

	// Static architecture facts (the real production model).
	const arch = [
		{ k: 'Parameters', v: '1.4B', d: 'mixture-of-experts' },
		{ k: 'Experts', v: '128', d: '4 active per token' },
		{ k: 'Layers', v: '8', d: '640 hidden dim' },
		{ k: 'Quantization', v: 'INT8', d: 'experts · fp16 embed' },
		{ k: 'PII classes', v: '9', d: 'BIOES · 37 tags' },
		{ k: 'Context', v: '1,024', d: 'tokens / pass' }
	];
	const fastArch = [
		{ k: 'nordic-ner', v: '135 MB', d: 'our DistilBERT · int8' },
		{ k: 'Blind F1', v: '0.95', d: 'cased · 0.94 lowercased' },
		{ k: 'Checksums', v: '5', d: 'fnr · pnr · IBAN · Luhn' },
		{ k: 'Languages', v: '8', d: 'no·nn·sv·da·fi·pl·is·en' }
	];
	const specs = $derived(isNordic ? arch : fastArch);
</script>

<div class="wrap">
	<div class="hd">
		<span class="dot" class:live={engine.status === 'ready'}></span>
		{isNordic ? 'nordic-v14' : 'fast engine'} · running on {deviceLabel}
	</div>
	<div class="grid">
		{#each specs as s (s.k)}
			<div class="cell">
				<div class="v">{s.v}</div>
				<div class="k">{s.k}</div>
				<div class="d">{s.d}</div>
			</div>
		{/each}
	</div>
	{#if engine.lastMs != null}
		<div class="live-row">
			<span><b>{engine.lastMs}</b> ms last run</span>
			{#if engine.lastTokens != null}<span><b>{engine.lastTokens}</b> tokens</span>{/if}
			{#if throughput != null}<span><b>{throughput.toLocaleString()}</b> tok/s</span>{/if}
			{#if engine.loadMs != null && isNordic}<span><b>{(engine.loadMs / 1000).toFixed(1)}</b> s GPU init</span>{/if}
		</div>
	{/if}
</div>

<style>
	.wrap {
		background: var(--card);
		border: 1px solid var(--rule);
		border-radius: 12px;
		padding: 14px 16px;
		margin: 12px 0 6px;
	}
	.hd {
		font-family: var(--font-mono);
		font-size: 0.74rem;
		letter-spacing: 0.04em;
		color: var(--ink-3);
		text-transform: uppercase;
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 12px;
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--ink-3);
	}
	.dot.live {
		background: var(--accent);
		box-shadow: 0 0 0 0 var(--accent);
		animation: pulse 2s infinite;
	}
	@keyframes pulse {
		0% {
			box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 55%, transparent);
		}
		70% {
			box-shadow: 0 0 0 6px transparent;
		}
		100% {
			box-shadow: 0 0 0 0 transparent;
		}
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(94px, 1fr));
		gap: 1px;
		background: var(--rule);
		border: 1px solid var(--rule);
		border-radius: 8px;
		overflow: hidden;
	}
	.cell {
		background: var(--card);
		padding: 10px 12px;
	}
	.v {
		font-family: var(--font-mono);
		font-weight: 700;
		font-size: 1.3rem;
		line-height: 1.05;
		color: var(--accent);
		font-variant-numeric: tabular-nums;
	}
	.k {
		font-size: 0.74rem;
		font-weight: 600;
		margin-top: 3px;
	}
	.d {
		font-size: 0.68rem;
		color: var(--ink-3);
		margin-top: 1px;
	}
	.live-row {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		margin-top: 12px;
		padding-top: 10px;
		border-top: 1px dashed var(--rule);
		font-size: 0.82rem;
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}
	.live-row b {
		color: var(--ink);
		font-family: var(--font-mono);
	}
</style>
