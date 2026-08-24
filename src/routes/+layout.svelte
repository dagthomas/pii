<script lang="ts">
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();

	const isHome = $derived(page.url.pathname === '/');
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if !isHome}
	<a class="back" href="/">
		<span aria-hidden="true">←</span> Back to the redactor
	</a>
{/if}

{@render children()}

<style>
	.back {
		position: sticky;
		top: 12px;
		z-index: 10;
		float: left;
		margin: 12px 0 0 12px;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font: 500 0.85rem/1 system-ui, sans-serif;
		padding: 9px 16px;
		border-radius: 999px;
		border: 1px solid var(--rule, #d8ddd8);
		background: var(--card, #fff);
		color: var(--ink-2, #4a544d);
		text-decoration: none;
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
	}
	.back:hover {
		border-color: var(--accent, #188a4f);
		color: var(--accent, #188a4f);
	}
	.back:focus-visible {
		outline: 2px solid var(--accent, #188a4f);
		outline-offset: 2px;
	}
	/* On narrow screens it sits in the flow above the page instead of beside it. */
	@media (max-width: 900px) {
		.back {
			position: static;
			float: none;
			display: flex;
			width: fit-content;
			margin: 16px 0 -20px 20px;
		}
	}
</style>
