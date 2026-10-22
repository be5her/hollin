import { Service, computed, signal, untracked, type Signal } from '@angular/core';
import type { Vec3 } from '@studio/core';

/** A model armed for the Item tool, from the Catalog panel. */
export interface ItemArm {
  ref: string;
  name: string;
  /** Its size and low corner, for a library model the project does not have yet. */
  size: Vec3 | null;
  min?: Vec3;
  /** A lamp, which can be placed with its light. */
  lamp?: boolean;
}

interface Armed {
  item: ItemArm;
  n: number;
}

/** A material armed for painting, from the Catalog panel: the plan's Paint tool and clicks in the 3D view give it to surfaces. */
export interface PaintArm {
  ref: string;
  name: string;
  n: number;
}

/** What another panel asks the plan's tools to do (a model armed in the Catalog panel): the plan view picks the tool. */
@Service()
export class PlanTools {
  private readonly armed = signal<Record<string, Armed | undefined>>({});
  private readonly paints = signal<Record<string, PaintArm | undefined>>({});
  private n = 0;

  /** Arms the Item tool on a project's plan with a model. */
  armItem(projectId: string, item: ItemArm): void {
    this.armed.update((all) => ({ ...all, [projectId]: { item, n: ++this.n } }));
  }

  armedItem(projectId: string): Signal<Armed | undefined> {
    return computed(() => this.armed()[projectId]);
  }

  /** Arms painting on a project with a material: the plan picks its Paint tool, the 3D view paints what is clicked. */
  armPaint(projectId: string, paint: { ref: string; name: string }): void {
    this.paints.update((all) => ({ ...all, [projectId]: { ...paint, n: ++this.n } }));
  }

  /** Ends painting (Escape, or another tool). */
  disarmPaint(projectId: string): void {
    if (untracked(this.paints)[projectId]) this.paints.update((all) => ({ ...all, [projectId]: undefined }));
  }

  armedPaint(projectId: string): Signal<PaintArm | undefined> {
    return computed(() => this.paints()[projectId]);
  }
}
