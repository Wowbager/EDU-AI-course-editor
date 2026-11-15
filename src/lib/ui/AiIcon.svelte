<script lang="ts">
	/**
	 * The mark of everything AI in the editor: two solid four-point stars with curved,
	 * concave sides, a large one low left and a small one high right. Filled, no outline,
	 * in the text colour. Drawn here, not taken from the icon set, because the set has no
	 * such mark.
	 */
	interface Props {
		size?: number;
	}
	let { size = 16 }: Props = $props();

	/** A four-point star around (x, y) with tips `r` away; the sides bow in towards the centre. */
	const star = (x: number, y: number, r: number, bow = 0.12): string => {
		const k = r * bow;
		return (
			`M${x} ${y - r}Q${x + k} ${y - k} ${x + r} ${y}Q${x + k} ${y + k} ${x} ${y + r}` +
			`Q${x - k} ${y + k} ${x - r} ${y}Q${x - k} ${y - k} ${x} ${y - r}Z`
		);
	};
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
	<path d={star(8, 16, 8)} />
	<path d={star(18.5, 5.5, 3.6, 0.16)} />
</svg>
