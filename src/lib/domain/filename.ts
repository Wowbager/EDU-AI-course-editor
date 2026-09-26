/**
 * What a downloaded course file is called: the course's name as the teacher typed it,
 * made safe for a file system — "Úvod do fotosyntézy" → "uvod-do-fotosyntezy.json".
 * It used to be the `course_id`, which is minted once and never shown, so a teacher
 * looking in Downloads for the name they typed found `NOVY_KURZ.json`.
 */
export function courseFileName(name: string | undefined, fallback = 'kurz', suffix = ''): string {
	const base =
		(name ?? '')
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 60)
			.replace(/-+$/, '') || fallback;
	return `${base}${suffix}.json`;
}
