/**
 * The course's skill configuration — the source of the GPF dimension count and the
 * dimension labels. §3 invariant 6: never hardcode 35, never hardcode the names.
 *
 * Shape mirrors the API:
 *   GET /api/courses/{id}/skill-config → { data: CourseSkillConfig | null }
 *   GET /api/gpf/dimensions           → { data: SkillDimension[] }   (canonical fallback)
 */

/**
 * The taxonomy as the admin exports it: domains → constructs → subconstructs.
 * This is the shape of `GPF - Matematika.json`, downloaded from the admin page.
 */
export interface GpfDomain {
	id: string;
	domain: string;
	constructs: {
		id: string;
		construct: string;
		subconstructs: { id: string; subconstruct: string }[];
	}[];
}

export interface SkillDimension {
	dimension_index: number;
	code: string;
	name: string;
	domain_code?: string;
	domain_name?: string;
	construct_code?: string;
	construct_name?: string;
}

export interface SkillVectorDef {
	id: string;
	name: string;
	dimension_count: number;
	dimensions: SkillDimension[];
}

export interface SkillConfig {
	id?: number;
	course_id?: number;
	vector_id?: string;
	formula_json?: Record<string, { dims: number[]; weights?: number[] }>;
	display_scale_min?: number;
	display_scale_max?: number;
	confidence_c?: number;
	min_count?: number;
	version?: number;
	is_default?: boolean;
	vector: SkillVectorDef | null;
}

/**
 * A skill config carrying no vector definition. Validation treats an unknown
 * dimension count as "cannot check length" rather than as a failure, so an editor
 * that has not reached the API yet does not spray false errors over a valid course.
 */
export const UNKNOWN_SKILL_CONFIG: SkillConfig = { vector: null };

export function dimensionCount(config: SkillConfig | null | undefined): number | null {
	const vector = config?.vector;
	if (!vector) return null;
	if (typeof vector.dimension_count === 'number' && vector.dimension_count > 0) {
		return vector.dimension_count;
	}
	return vector.dimensions?.length ?? null;
}

export function dimensionLabel(config: SkillConfig | null | undefined, index: number): string {
	const dim = config?.vector?.dimensions?.find((d) => d.dimension_index === index);
	if (!dim) return `#${index}`;
	return dim.code ? `${dim.code} ${dim.name}` : dim.name;
}

export function dimensionCode(config: SkillConfig | null | undefined, index: number): string {
	const dim = config?.vector?.dimensions?.find((d) => d.dimension_index === index);
	return dim?.code ?? `#${index}`;
}

/** Dimensions grouped by domain, in index order — the shape the vector editor renders. */
export function dimensionsByDomain(
	config: SkillConfig | null | undefined
): { domainCode: string; domainName: string; dimensions: SkillDimension[] }[] {
	const dims = [...(config?.vector?.dimensions ?? [])].sort(
		(a, b) => a.dimension_index - b.dimension_index
	);
	const groups: { domainCode: string; domainName: string; dimensions: SkillDimension[] }[] = [];
	for (const dim of dims) {
		const code = dim.domain_code ?? '';
		const last = groups[groups.length - 1];
		if (last && last.domainCode === code) last.dimensions.push(dim);
		else
			groups.push({
				domainCode: code,
				domainName: dim.domain_name ?? code,
				dimensions: [dim]
			});
	}
	return groups;
}

export interface SkillTreeLevel {
	/** 1-based position within the skill: what a teacher reads as "Úroveň N". */
	level: number;
	dimension: SkillDimension;
}
export interface SkillTreeSkill {
	code: string;
	name: string;
	levels: SkillTreeLevel[];
}
export interface SkillTreeArea {
	code: string;
	name: string;
	skills: SkillTreeSkill[];
}

/**
 * The vector as a teacher thinks of it: area → skill → level. Each dimension is one
 * level of one skill. Areas and skills come in order of their first dimension. A config
 * without construct data falls back to the code before the last dot (`N2.1` → `N2`),
 * and a dimension without a code is a skill of its own with a single level.
 */
export function skillTree(config: SkillConfig | null | undefined): SkillTreeArea[] {
	const dims = [...(config?.vector?.dimensions ?? [])].sort(
		(a, b) => a.dimension_index - b.dimension_index
	);
	const areas: SkillTreeArea[] = [];
	for (const dim of dims) {
		const areaCode = dim.domain_code ?? '';
		let area = areas.find((a) => a.code === areaCode);
		if (!area) {
			area = { code: areaCode, name: dim.domain_name ?? areaCode, skills: [] };
			areas.push(area);
		}
		const dot = dim.code ? dim.code.lastIndexOf('.') : -1;
		const derived = dim.construct_code ?? (dot > 0 ? dim.code.slice(0, dot) : '');
		const own = derived === '' ? `#${dim.dimension_index}` : derived;
		let skill = area.skills.find((s) => s.code === own);
		if (!skill) {
			skill = {
				code: own,
				name: dim.construct_name ?? (derived === '' ? dim.name : derived),
				levels: []
			};
			area.skills.push(skill);
		}
		skill.levels.push({ level: skill.levels.length + 1, dimension: dim });
	}
	return areas;
}

/**
 * Flatten the admin's taxonomy export into the dimension list the vectors index into.
 *
 * Document order *is* the vector order — the spec's own grouping (N 0–16, M 17–21,
 * G 22–24, S 25–28, A 29–34) falls out of reading the file top to bottom. The count
 * still comes from the data, so a subject with a different number of subconstructs
 * needs no change here.
 */
export function skillConfigFromGpfTaxonomy(domains: GpfDomain[], name = 'GPF'): SkillConfig {
	const dimensions: SkillDimension[] = [];
	for (const domain of domains) {
		for (const construct of domain.constructs ?? []) {
			for (const subconstruct of construct.subconstructs ?? []) {
				dimensions.push({
					dimension_index: dimensions.length,
					code: subconstruct.id,
					name: subconstruct.subconstruct,
					domain_code: domain.id,
					domain_name: domain.domain,
					construct_code: construct.id,
					construct_name: construct.construct
				});
			}
		}
	}
	return {
		is_default: true,
		vector: { id: 'gpf-taxonomy', name, dimension_count: dimensions.length, dimensions }
	};
}

/** True when a parsed JSON file is a taxonomy export rather than a course. */
export function looksLikeGpfTaxonomy(value: unknown): value is GpfDomain[] {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		typeof value[0] === 'object' &&
		value[0] !== null &&
		'constructs' in (value[0] as object) &&
		'domain' in (value[0] as object)
	);
}

/** Build a config from the canonical dimension list when a course has no own vector. */
export function skillConfigFromDimensions(dimensions: SkillDimension[]): SkillConfig {
	return {
		is_default: true,
		vector: {
			id: 'default',
			name: 'GPF',
			dimension_count: dimensions.length,
			dimensions
		}
	};
}

/** §6.3 — a student's rating starts here, so it is the neutral default for elo_vector. */
export const ELO_BASELINE = 6.0;
export const ELO_MIN = 1.0;
export const ELO_MAX = 10.0;

/**
 * The classification a card takes from its strongest topic: domain, construct and
 * "code name". One rule for the topic picker and for an AI tool that sets topics.
 */
export function topicNaming(
	config: SkillConfig | null | undefined,
	index: number
): { domain?: string; construct?: string; subconstruct?: string } {
	const dimension = config?.vector?.dimensions?.find((d) => d.dimension_index === index);
	if (dimension === undefined) return {};
	return {
		domain: dimension.domain_name,
		construct: dimension.construct_name,
		subconstruct: `${dimension.code} ${dimension.name}`
	};
}
