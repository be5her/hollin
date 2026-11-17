import { afterEach, describe, expect, it } from 'vitest';
import { StudioError, agentPayload, errorLine, errorText, toErrorPayload } from './errors';
import { setLanguage } from './i18n';

afterEach(() => setLanguage('en'));

describe('StudioError and its phrase', () => {
  it('makes its English message from the catalog and carries the phrase', () => {
    const err = new StudioError('NOT_FOUND', { key: 'errors.library.noProject', params: { id: 'prj_1' } });
    expect(err.message).toBe('No project with id prj_1');
    expect(err.i18n).toEqual({ key: 'errors.library.noProject', params: { id: 'prj_1' } });
    // The English message does not depend on the process language.
    setLanguage('ar');
    expect(new StudioError('CONFLICT', { key: 'errors.history.nothingToUndo' }).message).toBe('There is nothing to undo.');
  });

  it('crosses IPC as a payload and back without losing the phrase or changing the message', () => {
    const err = new StudioError('CONFLICT', { key: 'errors.level.hosted', params: { count: 2, names: '"A", "B"' } }, { kind: 'stale' });
    const payload = JSON.parse(JSON.stringify(toErrorPayload(err)));
    expect(payload).toEqual({ code: 'CONFLICT', message: 'Remove or re-host "A", "B" first: they are placed from this level.', details: { kind: 'stale' }, i18n: err.i18n });
    const rebuilt = StudioError.fromPayload(payload);
    expect(rebuilt).toBeInstanceOf(StudioError);
    expect(toErrorPayload(rebuilt)).toEqual(payload);
    // A plain object with a known code (the renderer's view of a payload) keeps it all too.
    expect(toErrorPayload(payload)).toEqual(payload);
  });

  it('leaves an error without a phrase as it was', () => {
    expect(toErrorPayload(new StudioError('NOT_FOUND', 'No level lvl_1'))).toEqual({ code: 'NOT_FOUND', message: 'No level lvl_1' });
    expect(toErrorPayload(new Error('boom'))).toEqual({ code: 'INTERNAL', message: 'boom' });
  });

  it('gives agents the English message only', () => {
    const payload = toErrorPayload(new StudioError('NOT_FOUND', { key: 'errors.library.noSnapshot', params: { id: 'snp_1' } }));
    expect(agentPayload(payload)).toEqual({ code: 'NOT_FOUND', message: 'No snapshot snp_1' });
  });
});

describe('what a person reads of an error', () => {
  it('is the English message in English, translated or not', () => {
    expect(errorText(new StudioError('CONFLICT', { key: 'errors.level.last' }), 'en')).toEqual({ text: 'A building needs at least one level.' });
    expect(errorText(new StudioError('NOT_FOUND', 'No layer lay_1'), 'en')).toEqual({ text: 'No layer lay_1' });
  });

  it('is the translation in Arabic, with nested phrases and commands translated too', () => {
    expect(errorText(new StudioError('CONFLICT', { key: 'errors.level.last' }), 'ar')).toEqual({ text: 'لا بد أن يبقى للمبنى طابق واحد على الأقل.' });
    const stale = new StudioError('CONFLICT', { key: 'errors.stale.changed', params: { what: { key: 'tools.noun.wall' }, by: { key: 'errors.stale.byYou' } } });
    expect(stale.message).toBe('The wall was changed by you meanwhile; nothing was changed. Look again and retry.');
    expect(errorText(stale, 'ar').text).toContain('جدار');
    expect(errorText(stale, 'ar').text).toContain('من قِبلك');
    const declined = new StudioError('MUTATION_DECLINED', { key: 'errors.registry.declined', params: { title: { command: { id: 'project.trash', title: 'Move project to trash' } } } });
    expect(declined.message).toBe('The user declined "Move project to trash".');
    expect(errorText(declined, 'ar').text).toContain('نقل المشروع إلى سلة المحذوفات');
  });

  it('is the code\'s lead with the English message as detail when the error has no translation', () => {
    const err = new StudioError('NOT_FOUND', 'No level lvl_9');
    expect(errorText(err, 'ar')).toEqual({ text: 'تعذّر العثور على المطلوب.', detail: 'No level lvl_9' });
    expect(errorLine(err, 'ar')).toBe('تعذّر العثور على المطلوب. \u2066No level lvl_9\u2069');
    // Anything thrown, in the process language.
    setLanguage('ar');
    expect(errorText(new Error('disk full'))).toEqual({ text: 'حدث خطأ غير متوقع.', detail: 'disk full' });
  });
});
