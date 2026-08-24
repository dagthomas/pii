<script lang="ts">
	/** Light / dark / follow-system, remembered across visits.
	 *  The stored choice is applied by an inline script in app.html before first paint,
	 *  so the page never flashes the wrong theme. This component only mutates it. */
	type Theme = 'light' | 'dark' | 'system';

	let theme = $state<Theme>('system');

	$effect(() => {
		try {
			const stored = localStorage.getItem('theme');
			if (stored === 'light' || stored === 'dark') theme = stored;
		} catch {
			/* private mode / blocked storage — follow the system and move on */
		}
	});

	function apply(next: Theme) {
		theme = next;
		const root = document.documentElement;
		if (next === 'system') root.removeAttribute('data-theme');
		else root.setAttribute('data-theme', next);
		try {
			if (next === 'system') localStorage.removeItem('theme');
			else localStorage.setItem('theme', next);
		} catch {
			/* not fatal — the choice just will not survive a reload */
		}
	}

	const OPTIONS: { value: Theme; label: string; icon: string }[] = [
		{ value: 'light', label: 'Light', icon: 'M12 4v1m0 14v1m8-8h-1M5 12H4m13.66-5.66-.7.7M7.05 16.95l-.71.71m11.32 0-.71-.71M7.05 7.05l-.71-.7' },
		{ value: 'system', label: 'System', icon: '' },
		{ value: 'dark', label: 'Dark', icon: 'M20 13.5A8.5 8.5 0 1 1 10.5 4a6.6 6.6 0 0 0 9.5 9.5Z' }
	];
</script>

<div class="toggle" role="radiogroup" aria-label="Colour theme">
	{#each OPTIONS as o (o.value)}
		<button
			type="button"
			role="radio"
			aria-checked={theme === o.value}
			class={['opt', { on: theme === o.value }]}
			onclick={() => apply(o.value)}
			title={o.label}
		>
			{#if o.value === 'light'}
				<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d={o.icon} /></svg>
			{:else if o.value === 'dark'}
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d={o.icon} /></svg>
			{:else}
				<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M8 21h8" /></svg>
			{/if}
			<span class="sr">{o.label}</span>
		</button>
	{/each}
</div>

<style>
	.toggle {
		display: inline-flex;
		gap: 2px;
		padding: 3px;
		border: 1px solid var(--line);
		background: var(--surface);
		border-radius: var(--radius-pill);
	}
	.opt {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		padding: 0;
		border: none;
		border-radius: var(--radius-pill);
		background: none;
		color: var(--ink-3);
		cursor: pointer;
		transition: color 0.12s ease, background-color 0.12s ease;
	}
	.opt:hover {
		color: var(--ink);
	}
	.opt.on {
		background: var(--accent-soft);
		color: var(--accent);
	}
	svg {
		width: 15px;
		height: 15px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.7;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
