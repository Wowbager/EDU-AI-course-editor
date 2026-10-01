import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	dimensionCount,
	dimensionsByDomain,
	looksLikeGpfTaxonomy,
	skillConfigFromGpfTaxonomy,
	skillTree,
	type GpfDomain
} from '../skill-config';
import { parseCourse } from '../document';
import { validate } from '../validate';

const taxonomy = JSON.parse(
	readFileSync(fileURLToPath(new URL('../../gpf/gpf-matematika.json', import.meta.url)), 'utf8')
) as GpfDomain[];

const fixture = (name: string): unknown =>
	JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'));

describe('the admin taxonomy export', () => {
	it('is recognised as a taxonomy and not as a course', () => {
		expect(looksLikeGpfTaxonomy(taxonomy)).toBe(true);
		expect(looksLikeGpfTaxonomy(fixture('spec-16-course.json'))).toBe(false);
	});

	const config = skillConfigFromGpfTaxonomy(taxonomy);

	it('flattens in document order, which is the vector order', () => {
		const dimensions = config.vector!.dimensions;
		expect(dimensions[0].code).toBe('N1.1');
		expect(dimensions.at(-1)!.code).toBe('A3.4');
		dimensions.forEach((dimension, i) => expect(dimension.dimension_index).toBe(i));
	});

	it('reproduces the domain index ranges the spec §6.3 states', () => {
		const rangeOf = (domain: string) => {
			const indices = config
				.vector!.dimensions.filter((d) => d.domain_code === domain)
				.map((d) => d.dimension_index);
			return [Math.min(...indices), Math.max(...indices)];
		};
		expect(rangeOf('N')).toEqual([0, 16]);
		expect(rangeOf('M')).toEqual([17, 21]);
		expect(rangeOf('G')).toEqual([22, 24]);
		expect(rangeOf('S')).toEqual([25, 28]);
		expect(rangeOf('A')).toEqual([29, 34]);
	});

	it('takes its count from the data rather than from a constant', () => {
		expect(dimensionCount(config)).toBe(35);

		// A subject with a different taxonomy needs no change here.
		const smaller = skillConfigFromGpfTaxonomy(taxonomy.slice(0, 1));
		expect(dimensionCount(smaller)).toBe(17);
	});

	it('groups by domain in index order, for the vector editor', () => {
		const groups = dimensionsByDomain(config);
		expect(groups.map((g) => g.domainCode)).toEqual(['N', 'M', 'G', 'S', 'A']);
		expect(groups[1].domainName).toBe('Míry');
	});

	it('validates the spec §16 course clean, exactly as the app-shipped list does', () => {
		const result = validate(parseCourse(fixture('spec-16-course.json')), config);
		expect(result.errors).toEqual([]);
		expect(result.warnings.map((w) => w.code)).toEqual([]);
	});

	it('flags a 35-element vector when the course uses a smaller taxonomy', () => {
		const smaller = skillConfigFromGpfTaxonomy(taxonomy.slice(0, 1));
		const result = validate(parseCourse(fixture('spec-16-course.json')), smaller);
		expect(result.errors.map((e) => e.code)).toContain('E_VECTOR_LENGTH');
	});
});

describe('skillTree', () => {
	const dim = (i: number, code: string, extra: object = {}) => ({
		dimension_index: i,
		code,
		name: `n${i}`,
		...extra
	});
	const cfg = (dimensions: ReturnType<typeof dim>[]) => ({
		vector: { id: 'x', name: 'x', dimension_count: dimensions.length, dimensions }
	});

	it('is empty without a config', () => {
		expect(skillTree(null)).toEqual([]);
		expect(skillTree(undefined)).toEqual([]);
		expect(skillTree({ vector: null })).toEqual([]);
	});

	it('turns the bundled taxonomy into 5 areas, 17 skills and 35 levels', () => {
		const tree = skillTree(skillConfigFromGpfTaxonomy(taxonomy));
		expect(tree).toHaveLength(5);
		expect(tree.flatMap((a) => a.skills)).toHaveLength(17);
		expect(tree.flatMap((a) => a.skills.flatMap((s) => s.levels))).toHaveLength(35);
		const zlomky = tree[0].skills.find((s) => s.code === 'N2')!;
		expect(zlomky.name).toBe('Zlomky');
		expect(zlomky.levels.map((l) => l.level)).toEqual([1, 2, 3]);
		expect(zlomky.levels.map((l) => l.dimension.code)).toEqual(['N2.1', 'N2.2', 'N2.3']);
	});

	it('keeps first-appearance order by dimension_index', () => {
		const tree = skillTree(
			cfg([
				dim(2, 'B1.1', { domain_code: 'B', domain_name: 'Bé' }),
				dim(0, 'A1.1', { domain_code: 'A', domain_name: 'Á' }),
				dim(1, 'A1.2', { domain_code: 'A', domain_name: 'Á' })
			])
		);
		expect(tree.map((a) => a.code)).toEqual(['A', 'B']);
		expect(tree[0].skills[0].levels.map((l) => l.dimension.dimension_index)).toEqual([0, 1]);
	});

	it('derives the skill from the code before the last dot when there is no construct', () => {
		const tree = skillTree(cfg([dim(0, 'N2.1'), dim(1, 'N2.2'), dim(2, 'N3.1')]));
		expect(tree).toHaveLength(1);
		expect(tree[0].skills.map((s) => [s.code, s.name, s.levels.length])).toEqual([
			['N2', 'N2', 2],
			['N3', 'N3', 1]
		]);
	});

	it('makes each dimension its own skill when it has no code at all', () => {
		const tree = skillTree(cfg([dim(0, ''), dim(1, '')]));
		expect(tree[0].skills.map((s) => [s.name, s.levels.length])).toEqual([
			['n0', 1],
			['n1', 1]
		]);
	});
});
