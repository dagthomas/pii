<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import ThemeToggle from '$lib/ThemeToggle.svelte';

	let { children } = $props();

	const NAV = [
		{ href: '/', label: 'Redact' },
		{ href: '/batch', label: 'Batch' },
		{ href: '/models', label: 'Models' },
		{ href: '/how-it-works', label: 'How it works' }
	];

	const current = $derived(page.url.pathname);
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<a class="skip" href="#main">Skip to content</a>

<header>
	<div class="bar">
		<a class="brand" href="/">
			<span class="dot" aria-hidden="true"></span>
			<span class="name">Nordic PII</span>
		</a>

		<nav aria-label="Sections">
			{#each NAV as item (item.href)}
				<a
					href={item.href}
					class={['link', { on: current === item.href }]}
					aria-current={current === item.href ? 'page' : undefined}>{item.label}</a
				>
			{/each}
		</nav>

		<ThemeToggle />
	</div>
</header>

<main id="main">
	{@render children()}
</main>

<footer>
	<p>Runs entirely in your browser. No text is uploaded.</p>
</footer>

<style>
	.skip {
		position: absolute;
		left: -9999px;
		top: var(--s-2);
		z-index: 20;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: var(--s-2) var(--s-4);
	}
	.skip:focus {
		left: var(--s-4);
	}

	header {
		position: sticky;
		top: 0;
		z-index: 10;
		background: color-mix(in srgb, var(--paper) 88%, transparent);
		backdrop-filter: blur(10px);
		border-bottom: 1px solid var(--line);
	}
	.bar {
		max-width: var(--container);
		margin: 0 auto;
		padding: var(--s-3) var(--s-5);
		display: flex;
		align-items: center;
		gap: var(--s-5);
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: var(--s-2);
		color: var(--ink);
		text-decoration: none;
		font-weight: 600;
		letter-spacing: -0.01em;
		white-space: nowrap;
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--accent);
	}

	nav {
		display: flex;
		gap: var(--s-1);
		margin-right: auto;
		overflow-x: auto;
		scrollbar-width: none;
	}
	nav::-webkit-scrollbar {
		display: none;
	}
	.link {
		padding: 6px var(--s-3);
		border-radius: var(--radius-pill);
		color: var(--ink-3);
		text-decoration: none;
		font-size: var(--step--1);
		font-weight: 500;
		white-space: nowrap;
		transition: color 0.12s ease, background-color 0.12s ease;
	}
	.link:hover {
		color: var(--ink);
		background: var(--surface-2);
	}
	.link.on {
		color: var(--accent);
		background: var(--accent-soft);
	}

	footer {
		max-width: var(--container);
		margin: 0 auto;
		padding: var(--s-5) var(--s-5) var(--s-7);
		border-top: 1px solid var(--line);
		color: var(--ink-3);
		font-size: var(--step--1);
	}

	/* The brand word is redundant next to the nav on a narrow screen */
	@media (max-width: 560px) {
		.bar {
			gap: var(--s-3);
			padding-inline: var(--s-4);
		}
		.name {
			display: none;
		}
	}
</style>
