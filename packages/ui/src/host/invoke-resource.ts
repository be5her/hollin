import { DestroyRef, computed, inject, linkedSignal, resource, untracked, type ResourceSnapshot, type Signal } from '@angular/core';
import { toErrorPayload, type ErrorPayload, type HostEventName } from '@studio/core';
import { AppState } from '../state/app-state';
import { HostBridge } from './host-bridge';

export interface InvokeResourceOptions {
  /** Explicit project, `null` for a global command. Defaults to the project on screen. */
  projectId?: string | null | (() => string | null);
  /** Reload on these host events. */
  refreshOnEvents?: readonly HostEventName[];
  /** While false, nothing is requested. */
  enabled?: () => boolean;
}

export interface InvokeResource<T> {
  /** The latest result. It stays while a new one loads and after a failed reload, so lists do not blink. */
  readonly value: Signal<T | undefined>;
  /** The error of the last load, cleared by the next successful one. */
  readonly error: Signal<ErrorPayload | null>;
  readonly isLoading: Signal<boolean>;
  /** Run the command again with the same input. */
  reload(): void;
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * A host command as a `resource()`: it runs whenever its input (read reactively from `input`) or its
 * project changes, and again on the host events named in the options, keeping its last value while
 * it reloads. Call it in an injection context; it stops listening when that context is destroyed.
 */
export function invokeResource<T>(id: string, input: () => unknown = () => ({}), options: InvokeResourceOptions = {}): InvokeResource<T> {
  const host = inject(HostBridge);
  const app = inject(AppState);

  const projectId = computed(() => {
    const p = options.projectId;
    return p === undefined ? app.activeProjectId() : typeof p === 'function' ? p() : p;
  });
  // Compared by content, so an input rebuilt with the same values does not run the command again.
  const params = computed(() => ((options.enabled?.() ?? true) ? { input: input(), projectId: projectId() } : undefined), { equal: sameJson });
  const ref = resource({
    params,
    loader: ({ params: p }) => host.invoke<T>(id, p.input, p.projectId),
  });

  const value = linkedSignal<ResourceSnapshot<T | undefined>, T | undefined>({
    source: ref.snapshot,
    computation: (snapshot, previous) =>
      snapshot.status === 'resolved' || snapshot.status === 'reloading' || snapshot.status === 'local' ? snapshot.value : previous?.value,
  });
  const error = linkedSignal<ResourceSnapshot<T | undefined>, ErrorPayload | null>({
    source: ref.snapshot,
    computation: (snapshot, previous) => (snapshot.status === 'error' ? toErrorPayload(snapshot.error) : snapshot.status === 'resolved' ? null : (previous?.value ?? null)),
  });

  const offs = (options.refreshOnEvents ?? []).map((event) => host.on(event, () => untracked(() => ref.reload())));
  inject(DestroyRef).onDestroy(() => offs.forEach((off) => off()));

  return {
    value: value.asReadonly(),
    error: error.asReadonly(),
    isLoading: ref.isLoading,
    reload: () => void ref.reload(),
  };
}
