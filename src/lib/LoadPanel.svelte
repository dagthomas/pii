<script lang="ts">
	interface LoadableEngine {
		status: string;
		progress: string;
		pct?: number | null;
		mb?: number | null;
		phase?: 'download' | 'prepare' | null;
	}
	interface Props {
		engine: LoadableEngine;
		big?: boolean;
	}
	let { engine, big = false }: Props = $props();

	const pct = $derived(engine.pct ?? null);
	const title = $derived(
		engine.phase === 'prepare'
			? 'Preparing the model on your GPU…'
			: pct !== null
				? `Downloading the model — ${pct}%`
				: 'Loading model…'
	);
	const detail = $derived(
		engine.phase === 'prepare'
			? 'Compiling shaders and allocating weights. This takes a few seconds.'
			: pct !== null
				? `${engine.mb ?? 0} MB of ~1,890 MB · one-time download, cached by your browser`
				: engine.progress || 'Starting…'
	);
</script>

<div class={['panel', { big }]} role="status" aria-live="polite">
	<div class="spinner" aria-hidden="true"></div>
	<div class="txt">
		<p class="t">{title}</p>
		<div class="track">
			<div class={['fill', { indet: pct === null }]} style:width={pct !== null ? pct + '%' : undefined}></div>
		</div>
		<p class="d">{detail}</p>
	</div>
</div>

<style>
	.panel {
		display: flex;
		gap: 16px;
		align-items: center;
		background: var(--card);
		border: 1px solid var(--accent);
		border-radius: 12px;
		padding: 18px 20px;
		margin: 14px 0;
	}
	.spinner {
		width: 34px;
		height: 34px;
		flex: none;
		border-radius: 50%;
		border: 3px solid var(--accent-soft);
		border-top-color: var(--accent);
		animation: spin 0.9s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.txt {
		flex: 1;
		min-width: 0;
	}
	.t {
		margin: 0 0 8px;
		font-weight: 600;
	}
	.track {
		height: 10px;
		border-radius: 999px;
		background: var(--accent-soft);
		overflow: hidden;
	}
	.fill {
		height: 100%;
		background: var(--accent);
		border-radius: 999px;
		transition: width 0.3s;
	}
	.fill.indet {
		width: 35%;
		animation: slide 1.2s ease-in-out infinite alternate;
	}
	@keyframes slide {
		from {
			margin-left: 0;
		}
		to {
			margin-left: 65%;
		}
	}
	.d {
		margin: 8px 0 0;
		font-size: 0.84rem;
		color: var(--ink-3);
	}
	@media (prefers-reduced-motion: reduce) {
		.spinner,
		.fill.indet {
			animation: none;
		}
	}
</style>
