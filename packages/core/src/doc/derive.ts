import { StudioError } from '../errors';
import { roundMm } from '../geometry/vec';
import type { Entity, Level, ProjectDoc } from './schema';

/** A level with its elevation worked out. Elevations are derived, never stored. */
export interface DerivedLevel {
  id: string;
  name: string;
  /** Floor level, in mm (negative below ground). */
  elevation: number;
  height: number;
  /** elevation + height: where the next level up starts. */
  top: number;
  slabThickness: number;
  placement: 'stack' | 'offset';
  isGround: boolean;
  /** Stacked below the ground level. */
  isBasement: boolean;
  /** Position in the stack (bottom 0); offset levels take their host's. */
  stackIndex: number;
  hostLevelId?: string;
}

const heightOf = (level: Level) => level.place.height;

/**
 * Every level's elevation: the ground level sits at the datum; stacked levels above it add up the
 * heights below them; basements hang below, each its own height lower; offset levels (mezzanines,
 * split levels) sit at their offset above a stacked host. Sorted bottom to top.
 */
export function deriveLevels(doc: Pick<ProjectDoc, 'building' | 'levels'>): DerivedLevel[] {
  const { stack, groundLevelId, datum } = doc.building;
  const ground = stack.indexOf(groundLevelId);
  const elevations = new Map<string, number>();
  if (ground >= 0) {
    elevations.set(stack[ground], datum);
    for (let i = ground + 1; i < stack.length; i++) elevations.set(stack[i], elevations.get(stack[i - 1])! + heightOf(doc.levels[stack[i - 1]]));
    for (let i = ground - 1; i >= 0; i--) elevations.set(stack[i], elevations.get(stack[i + 1])! - heightOf(doc.levels[stack[i]]));
  }
  const out: DerivedLevel[] = [];
  stack.forEach((id, i) => {
    const level = doc.levels[id];
    if (!level) return;
    const elevation = roundMm(elevations.get(id) ?? 0);
    out.push({ id, name: level.name, elevation, height: heightOf(level), top: roundMm(elevation + heightOf(level)), slabThickness: level.slabThickness, placement: 'stack', isGround: id === groundLevelId, isBasement: i < ground, stackIndex: i });
  });
  for (const level of Object.values(doc.levels)) {
    if (level.place.k !== 'offset') continue;
    const host = out.find((l) => l.id === (level.place as { hostLevelId: string }).hostLevelId);
    const elevation = roundMm((host?.elevation ?? 0) + level.place.offset);
    out.push({ id: level.id, name: level.name, elevation, height: level.place.height, top: roundMm(elevation + level.place.height), slabThickness: level.slabThickness, placement: 'offset', isGround: false, isBasement: Boolean(host?.isBasement), stackIndex: host?.stackIndex ?? 0, hostLevelId: host?.id });
  }
  return out.sort((a, b) => a.elevation - b.elevation || a.stackIndex - b.stackIndex || (a.placement === 'stack' ? -1 : 1));
}

/** Where a level's walls of full height end: under the slab of the stacked level on top of it, or at its own top. */
export function levelCeiling(level: DerivedLevel, levels: readonly DerivedLevel[]): number {
  if (level.placement !== 'stack') return level.top;
  const above = levels.find((l) => l.placement === 'stack' && l.stackIndex === level.stackIndex + 1);
  const ceiling = level.top - (above?.slabThickness ?? 0);
  return ceiling > level.elevation ? ceiling : level.top;
}

export function levelElevation(doc: Pick<ProjectDoc, 'building' | 'levels'>, levelId: string): number {
  const found = deriveLevels(doc).find((l) => l.id === levelId);
  if (!found) throw new StudioError('NOT_FOUND', `No level ${levelId}`);
  return found.elevation;
}

/**
 * What to change so a level ends up at `elevation`, following the rule for its kind:
 * the ground level moves the datum (the whole building moves); a level above ground changes the
 * height of the level below it; a basement changes its own height; an offset level changes its offset.
 */
export function elevationChange(doc: Pick<ProjectDoc, 'building' | 'levels'>, levelId: string, elevation: number): { kind: 'datum'; datum: number } | { kind: 'height'; levelId: string; height: number } | { kind: 'offset'; levelId: string; offset: number } {
  const levels = deriveLevels(doc);
  const target = levels.find((l) => l.id === levelId);
  if (!target) throw new StudioError('NOT_FOUND', `No level ${levelId}`);
  const { stack } = doc.building;
  if (target.isGround) return { kind: 'datum', datum: roundMm(elevation) };
  if (target.placement === 'offset') {
    const host = levels.find((l) => l.id === target.hostLevelId)!;
    return { kind: 'offset', levelId, offset: roundMm(elevation - host.elevation) };
  }
  const i = stack.indexOf(levelId);
  if (!target.isBasement) {
    const below = levels.find((l) => l.id === stack[i - 1])!;
    const height = roundMm(elevation - below.elevation);
    if (height <= 0) throw new StudioError('INVALID_INPUT', `"${target.name}" cannot be at or below "${below.name}" (${below.elevation} mm).`);
    return { kind: 'height', levelId: below.id, height };
  }
  const above = levels.find((l) => l.id === stack[i + 1])!;
  const height = roundMm(above.elevation - elevation);
  if (height <= 0) throw new StudioError('INVALID_INPUT', `"${target.name}" cannot be at or above "${above.name}" (${above.elevation} mm).`);
  return { kind: 'height', levelId, height };
}

/**
 * The entities shown on a level: its own, plus entities from other levels that run through it
 * (columns, shafts, voids with a span), judged by elevation so mezzanines inside a span count too.
 */
export function entitiesOnLevel(doc: ProjectDoc, levelId: string): Entity[] {
  const own = Object.values(doc.levelData[levelId]?.entities ?? {});
  const levels = deriveLevels(doc);
  const target = levels.find((l) => l.id === levelId);
  if (!target) return own;
  const passing: Entity[] = [];
  for (const [otherId, data] of Object.entries(doc.levelData)) {
    if (otherId === levelId) continue;
    const baseLevel = levels.find((l) => l.id === otherId);
    if (!baseLevel) continue;
    for (const entity of Object.values(data.entities)) {
      const span = 'span' in entity ? entity.span : undefined;
      if (!span) continue;
      const topLevel = levels.find((l) => l.id === span.topLevelId);
      if (!topLevel) continue;
      // It runs from `bottom` up to (not including) `top`: a level whose floor lies in between shows it.
      const bottom = baseLevel.elevation + span.baseOffset;
      const top = topLevel.elevation + span.topOffset;
      if (target.elevation >= bottom && target.elevation < top) passing.push(entity);
    }
  }
  return [...own, ...passing];
}
