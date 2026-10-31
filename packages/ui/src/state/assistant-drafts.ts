import { Service, signal } from '@angular/core';

/** A sentence another view hands to a project's assistant panel, to put in its message field. */
export interface AssistantDraftOffer {
  projectId: string;
  text: string;
}

/**
 * How Home's composer and the empty project's Otto line put a sentence into a project's assistant
 * panel without sending it: `offer` it, and the panel (once it is shown for that project) takes it into
 * its message field. Nothing is sent: the user reads, edits and sends it.
 */
@Service()
export class AssistantDrafts {
  private readonly offered = signal<AssistantDraftOffer | null>(null);

  /** The sentence waiting for its project's panel, if any. */
  readonly pending = this.offered.asReadonly();

  offer(projectId: string, text: string): void {
    this.offered.set({ projectId, text });
  }

  /** The panel of `projectId` takes the waiting sentence, which is then gone. */
  take(projectId: string): string | null {
    const offer = this.offered();
    if (!offer || offer.projectId !== projectId) return null;
    this.offered.set(null);
    return offer.text;
  }
}
