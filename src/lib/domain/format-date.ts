/**
 * An ISO timestamp as a teacher reads a date: `12. 2. 2026, 13:00` in the local time
 * zone. Something that is not a date is returned as it is, so nothing is ever hidden.
 */
export function formatDateTimeCs(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return `${date.getDate()}. ${date.getMonth() + 1}. ${date.getFullYear()}, ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}
