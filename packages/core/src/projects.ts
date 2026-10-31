/** A project as the library lists it. */
export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  openedAt: string | null;
  levelCount: number;
  /** Changes whenever the thumbnail does (for cache busting); null without one. */
  thumbnail: string | null;
  trashedAt: string | null;
  /** When a save last landed after an edit by Otto (the in-app assistant); absent when Otto never worked on it. Home marks the card. */
  assistantEditedAt?: string;
}

export interface SnapshotInfo {
  id: string;
  name: string;
  kind: 'named' | 'auto';
  createdAt: string;
  createdBy: string;
  levelCount: number;
}

export interface ListQuery {
  /** Matches name, description and tags, ignoring case and accents. */
  query?: string;
  /** Every tag must be present. */
  tags?: string[];
  sort?: 'recent' | 'name' | 'created' | 'opened';
  trashed?: boolean;
}

export type SaveStatus = { state: 'saved'; savedAt: string } | { state: 'dirty' } | { state: 'saving' } | { state: 'failed'; error: string };

/** An open project, as the tabs list them. */
export interface OpenProject extends ProjectSummary {
  save: SaveStatus;
}

export interface LibraryInfo {
  path: string;
  isDefault: boolean;
  projects: number;
  trashed: number;
  /** Another copy of the app (on this or another computer) was using the library when it was opened. */
  lockedBy: { host: string; pid: number; heartbeatAt: string } | null;
  /** A warning about the location, e.g. a cloud-synced folder. */
  warning: string | null;
}

/** Names a project URL for the renderer: `library://project/<id>/thumbnail.png?v=<version>`. */
export function thumbnailUrl(summary: Pick<ProjectSummary, 'id' | 'thumbnail'>): string | null {
  return summary.thumbnail ? `library://project/${summary.id}/thumbnail.png?v=${encodeURIComponent(summary.thumbnail)}` : null;
}
