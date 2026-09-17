<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '$lib/styles/tokens.css';
	import '$lib/styles/app.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>EDU-AI — editor kurzu</title>
</svelte:head>

{@render children()}
