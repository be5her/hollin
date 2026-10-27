import type { FileDialogOptions, HostApi } from '@studio/core';

type Asked = { kind: 'pickFile' | 'pickSavePath' | 'pickFolder'; options: FileDialogOptions };

/**
 * The host's native dialogs in smoke runs: no picker ever opens. Each pick answers with the next path
 * queued by `Smoke.nextDialogPath` (or as cancelled when none is queued) and is recorded with its
 * options in `asked`; `reveal` records the path instead of opening the file manager.
 */
class SmokeDialogs implements NonNullable<HostApi['dialogs']> {
  readonly asked: Asked[] = [];
  readonly revealed: string[] = [];
  private readonly answers: (string | undefined)[] = [];

  /** Queues the answer of the next picker; `undefined` cancels it. */
  answerNext(path: string | undefined): void {
    this.answers.push(path);
  }

  private answer(kind: Asked['kind'], options: FileDialogOptions = {}): Promise<string | undefined> {
    this.asked.push({ kind, options });
    return Promise.resolve(this.answers.shift());
  }

  pickFile(options?: FileDialogOptions) {
    return this.answer('pickFile', options);
  }

  pickSavePath(options?: FileDialogOptions) {
    return this.answer('pickSavePath', options);
  }

  pickFolder(options?: { title?: string; defaultPath?: string }) {
    return this.answer('pickFolder', options);
  }

  reveal(path: string): void {
    this.revealed.push(path);
  }
}

export const smokeDialogs = new SmokeDialogs();
