import { Service } from '@angular/core';
import { LevelGeometryCache } from '@studio/viewport';

/** One geometry cache for the renderer, shared by the plan view (which draws from it) and the Properties panel (which reads room areas from it). */
@Service()
export class PlanGeometry {
  readonly cache = new LevelGeometryCache();
}
