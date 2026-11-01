import fs from 'node:fs';
import path from 'node:path';
import type { Entity, HistoryInfo, McpCallEntry } from '@studio/core';
import fakeClaudeSource from '@studio/modules/assistant/fake-claude.cjs?raw';
import type { Smoke } from './harness';
import { openProjectTab, tab } from './plan-canvas';

type LogEntry = { type: string; pid: number; resume?: string | null; model?: string | null; effort?: string | null; mcpUrl?: string; name?: string; isError?: boolean; result?: { type: string; text?: string }[] };

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * The assistant on the Claude Code provider, against the fake binary (`fake-claude.cjs`, written to
 * the smoke's data folder) whose tool calls go through the app's real MCP server: the provider switched
 * in Settings, the not-found and not-logged-in empty states, the MCP server turned off in Settings with
 * the notice and its button in the chat, a plan_apply edit landing as one undoable transaction by
 * Otto ("claude-code 9.9.9" on the undo entry), a destructive call waiting until declined then allowed, Stop killing
 * the process and the next message resuming the stored session with its history, the project closed
 * and reopened, and the call log with the calls as the assistant. The real Claude Code is never run.
 */
export async function smokeAssistantClaudeCode(smoke: Smoke, duplexId: string): Promise<void> {
  smoke.section('assistant (Claude Code)');
  const dataDir = smoke.host.api.dataDir!;
  const fakePath = path.join(dataDir, 'fake-claude.cjs');
  const scriptFile = path.join(dataDir, 'fake-claude-script.json');
  const logFile = path.join(dataDir, 'fake-claude-log.jsonl');
  fs.writeFileSync(fakePath, fakeClaudeSource);
  process.env.FAKE_CLAUDE_SCRIPT = scriptFile;
  process.env.FAKE_CLAUDE_LOG = logFile;
  const writeScript = (script: unknown) => fs.writeFileSync(scriptFile, JSON.stringify(script));
  const readLog = (): LogEntry[] => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as LogEntry) : []);
  const starts = () => readLog().filter((e) => e.type === 'start');
  const doc = () => smoke.host.projects.session(duplexId)!.doc;
  const ground = doc().building.groundLevelId;
  const walls = () => Object.values(doc().levelData[ground].entities).filter((e: Entity) => e.type === 'wall').length;
  const run = <T = unknown>(id: string, input: unknown = {}) => smoke.run<T>(id, input, { projectId: duplexId });
  const panel = `${tab} [data-testid=assistant-panel]`;
  const send = async (text: string) => {
    // The reply's last words show before the run ends and Send is enabled again: wait for idle, and for a stopped process to be gone
    // (the composer is disabled until then), or the click is lost.
    await smoke.until(async () => {
      const state = await run<{ status: string; stopping: boolean }>('assistant.state');
      return state.status === 'idle' && !state.stopping;
    }, 30_000);
    await smoke.gone(`${panel} [data-testid=assistant-stop]`, 3000);
    await smoke.fill(`${panel} [data-testid=assistant-input]`, text);
    await smoke.click(`${panel} [data-testid=assistant-send]`);
  };
  const openSettings = async () => {
    await smoke.click('[data-testid=titlebar-settings]');
    await smoke.waitFor('[data-testid=settings]');
  };
  const openAssistant = async () => {
    await openProjectTab(smoke, duplexId);
    await smoke.click(`${tab} [data-testid=right-tab-assistant]`);
  };

  try {
    // Settings: the provider switched in the UI; with a path that leads nowhere, Settings and the panel say so.
    // The path goes first so the switch never probes a Claude Code the machine may really have.
    await smoke.run('config.update', { patch: { ai: { claudeCodePath: path.join(dataDir, 'nowhere', 'claude') } } });
    await openSettings();
    await smoke.fill('[data-testid=settings-provider]', 'claude-code');
    smoke.check('the provider choice in Settings is stored', await smoke.until(() => smoke.host.config.get().ai.provider === 'claude-code'));
    smoke.check('Settings shows the Claude Code command and the usage note', (await smoke.waitFor('[data-testid=settings-claude-code-path]')) && (await smoke.count('[data-testid=settings-claude-code-note]')) === 1);
    smoke.check('Settings reports a Claude Code that is not found', await smoke.waitFor('[data-testid=settings-claude-code-state]', 5000, 'Not found'));
    await smoke.js(`document.querySelector('[data-section="ai"]').scrollIntoView({ block: 'start' })`);
    await smoke.shots('32-settings-claude-code');
    await openAssistant();
    smoke.check('the panel says Claude Code was not found', (await smoke.waitFor(`${panel} [data-testid=assistant-empty][data-reason=not-found]`, 5000)) && (await smoke.count(`${panel} [data-testid=assistant-input]`)) === 0);

    // Logged out: the fake says so until the environment changes and the user checks again.
    process.env.FAKE_CLAUDE_LOGGED_OUT = '1';
    await smoke.run('config.update', { patch: { ai: { claudeCodePath: fakePath } } });
    // The panel can show the answer only once the new path has been probed (the fake run twice through the app's executable),
    // which a busy machine can take more than the panel's wait over: wait for the probe itself, which the panel's own request shares.
    const probed = await smoke.until(async () => (await smoke.run<{ claudeCode: { found: boolean; loggedIn: boolean | null } | null }>('assistant.status')).claudeCode?.found === true, 30_000, 200);
    smoke.check(
      'the panel says Claude Code is not logged in',
      probed && (await smoke.waitFor(`${panel} [data-testid=assistant-empty][data-reason=not-logged-in]`, 5000)),
      `showing ${await smoke.js<string>(`document.querySelector('${panel} [data-testid=assistant-empty]')?.dataset.reason ?? (document.querySelector('${panel} [data-testid=assistant-input]') ? 'the chat' : 'nothing')`)}`,
    );
    smoke.check("the logged-out state speaks in Otto's voice, with the mark", (await smoke.waitFor(`${panel} [data-testid=assistant-empty][data-reason=not-logged-in]`, 3000, "I can't work yet: Claude Code is not logged in")) && (await smoke.count(`${panel} [data-testid=assistant-empty] x-otto-mark[aria-label=Otto]`)) === 1);
    smoke.check('the header says so in place of the model', await smoke.waitFor(`${panel} [data-testid=assistant-setup-line]`, 3000, 'Claude Code not logged in'));
    smoke.check('the status bar says Otto needs Claude Code logged in', await smoke.waitFor('[data-testid=status-otto][data-state=not-logged-in]', 5000, 'Otto · Claude Code not logged in'));
    delete process.env.FAKE_CLAUDE_LOGGED_OUT;
    await smoke.click(`${panel} [data-testid=assistant-check-again]`);
    // Check again probes anew; wait for that probe to answer before looking at the panel.
    await smoke.until(async () => (await smoke.run<{ claudeCode: { loggedIn: boolean | null } | null }>('assistant.status')).claudeCode?.loggedIn === true, 30_000, 200);
    smoke.check('Check again finds it logged in and the chat opens', await smoke.waitFor(`${panel} [data-testid=assistant-input]`, 5000));
    smoke.check('the header names Claude Code and its version', (await smoke.text(`${panel} [data-testid=assistant-model]`))?.includes('Claude Code 9.9.9') === true, await smoke.text(`${panel} [data-testid=assistant-model]`));

    // The MCP server turned off in Settings: the chat shows the notice, refuses to send, and the button turns the server on as the user's own action.
    await openSettings();
    await smoke.click('[data-testid=settings-mcp-enabled]');
    smoke.check('the MCP server is off after the switch in Settings', await smoke.until(() => !smoke.host.config.get().mcp.enabled && !smoke.host.mcpStatus().running));
    await openAssistant();
    smoke.check('the chat shows that the MCP server is off', await smoke.waitFor(`${panel} [data-testid=assistant-mcp-off]`, 5000));
    await smoke.expectError('sending is refused while the MCP server is off', 'assistant.send', { text: 'hi' }, 'UNAVAILABLE', { projectId: duplexId });
    smoke.check('and no Claude Code process was started', starts().length === 0);
    await smoke.shots('31-assistant-mcp-off');
    await smoke.click(`${panel} [data-testid=assistant-enable-mcp]`);
    smoke.check('Enable MCP server turns the server on', await smoke.until(() => smoke.host.config.get().mcp.enabled && smoke.host.mcpStatus().running));
    smoke.check('the notice goes away', await smoke.gone(`${panel} [data-testid=assistant-mcp-off]`, 5000));

    // A design edit through the real MCP server: one undoable transaction attributed to Claude Code.
    const before = walls();
    const callsBefore = (await smoke.run<McpCallEntry[]>('mcp.calls')).length;
    writeScript({
      sessionId: 'smoke-sess-1',
      messages: [[{ text: 'Adding the wall.', tools: [{ name: 'plan_apply', input: { label: 'Add a 3 m wall', steps: [{ command: 'plan.wall.add', input: { levelId: ground, from: [3000, 7000], to: [6000, 7000], thickness: 150 } }] } }] }, { text: 'Done: a 3 m wall on the ground floor.' }]],
    });
    await send('Add a 3 m wall');
    smoke.check('the message shows in the chat', await smoke.waitFor(`${panel} [data-testid=assistant-item][data-kind=user]`, 5000, 'Add a 3 m wall'));
    smoke.check('the reply streams in', await smoke.waitFor(`${panel} [data-testid=assistant-item][data-kind=assistant]`, 30_000, 'Done: a 3 m wall'));
    smoke.check('the tool call is shown done, with the batch label', (await smoke.waitFor(`${panel} [data-testid=assistant-tool][data-command="plan.apply"][data-status=ok]`, 3000)) && (await smoke.text(`${panel} [data-testid=assistant-tool]`))?.includes('Add a 3 m wall') === true);
    smoke.check('the wall was added', await smoke.until(() => walls() === before + 1));
    const history = await run<{ undo: HistoryInfo[] }>('edit.history');
    smoke.check('the history has one entry labelled by the batch, by the assistant as claude-code 9.9.9', history.undo[0]?.label === 'Add a 3 m wall' && history.undo[0].author.kind === 'assistant' && history.undo[0].author.name === 'claude-code 9.9.9', history.undo[0]);
    await smoke.click(`${tab} [data-testid=right-tab-history]`);
    smoke.check('the History panel lists the change signed Otto', await smoke.waitFor(`${tab} [data-testid=history-item][data-label="Add a 3 m wall"][data-author="Otto"]`, 3000, 'Otto · Structure · plan.apply'));
    await smoke.click(`${tab} [data-testid=right-tab-assistant]`);
    await run('edit.undo');
    smoke.check('one undo removes it', await smoke.until(() => walls() === before));
    const first = starts()[0];
    smoke.check('the process got the app\'s MCP server with the project and a token', starts().length === 1 && new RegExp(`^${smoke.host.mcpStatus().url}\\?project=${duplexId}&assistant=[A-Za-z0-9_-]{40,}$`).test(first?.mcpUrl ?? ''), first?.mcpUrl);
    const calls = (await smoke.run<McpCallEntry[]>('mcp.calls')).slice(callsBefore);
    smoke.check('the MCP server logged the call as the assistant', calls.some((c) => c.tool === 'plan.apply' && c.ok && c.caller === 'assistant' && c.agent === 'claude-code 9.9.9'), calls);
    smoke.check('the chat is idle again', await smoke.gone(`${panel} [data-testid=assistant-stop]`, 3000));
    await smoke.shots('30-assistant-claude-code');

    // A destructive call waits for the user, declined then allowed, on the same process.
    writeScript({ messages: [[{ tools: [{ name: 'smoke_destroy' }] }, { text: 'I left it alone.' }], [{ tools: [{ name: 'smoke_destroy' }] }, { text: 'Wiped.' }]] });
    await send('Wipe it');
    smoke.check('a destructive call waits for the user in the chat', await smoke.waitFor(`${panel} [data-testid=assistant-confirm][data-command="smoke.destroy"]`, 5000));
    await smoke.click(`${panel} [data-testid=assistant-decline]`);
    smoke.check('and the chat shows the call declined', await smoke.waitFor(`${panel} [data-testid=assistant-tool][data-command="smoke.destroy"][data-status=declined]`, 3000));
    await smoke.waitFor(`${panel} [data-testid=assistant-item][data-kind=assistant]`, 5000, 'I left it alone.');
    const declined = readLog().filter((e) => e.type === 'call' && e.name === 'smoke_destroy')[0];
    smoke.check('the real server told Claude Code the call was declined', declined?.isError === true && (JSON.parse(declined.result![0].text!) as { code: string }).code === 'MUTATION_DECLINED', declined);
    await send('Really wipe it');
    smoke.check('the second attempt waits again', await smoke.waitFor(`${panel} [data-testid=assistant-confirm]`, 5000));
    await smoke.click(`${panel} [data-testid=assistant-allow]`);
    smoke.check('allowing runs it', await smoke.waitFor(`${panel} [data-testid=assistant-tool][data-command="smoke.destroy"][data-status=ok]`, 5000));
    await smoke.waitFor(`${panel} [data-testid=assistant-item][data-kind=assistant]`, 5000, 'Wiped.');
    smoke.check('one process served every message so far', starts().length === 1);

    // Stop kills the process; the next message starts one that resumes the session, with the earlier messages replayed.
    writeScript({ messages: [[{ tools: [{ name: 'smoke_destroy' }] }]] });
    await send('Wipe once more');
    await smoke.waitFor(`${panel} [data-testid=assistant-confirm]`, 5000);
    await smoke.click(`${panel} [data-testid=assistant-stop]`);
    // Killing a process tree (taskkill on Windows) and seeing it gone can take seconds on a busy machine: wait for that, not a fixed few.
    smoke.check('Stop kills the Claude Code process', await smoke.until(() => !alive(first.pid), 30_000));
    smoke.check('and the chat is idle, still on its session', (await smoke.gone(`${panel} [data-testid=assistant-stop]`, 3000)) && (await run<{ sessionId: string | null }>('assistant.state')).sessionId === 'smoke-sess-1');
    writeScript({
      expectResume: 'smoke-sess-1',
      replay: [
        { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'An earlier question' }] } },
        { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'An earlier answer' }] } },
      ],
      messages: [[{ text: 'Back on the same session.' }]],
    });
    await send('Continue');
    smoke.check('the next message is answered by a fresh process that resumed the session', (await smoke.waitFor(`${panel} [data-testid=assistant-item][data-kind=assistant]`, 30_000, 'Back on the same session.')) && starts().length === 2 && starts()[1].resume === 'smoke-sess-1' && starts()[1].mcpUrl !== first.mcpUrl, starts().map((s) => s.resume));
    const texts = await smoke.js<string[]>(`Array.from(document.querySelectorAll('${panel} [data-testid=assistant-item]')).map((e) => e.textContent.trim())`);
    smoke.check('the replayed history shows before the new message', texts.indexOf('An earlier answer') > -1 && texts.indexOf('An earlier answer') < texts.indexOf('Continue'), texts);

    // Closed and reopened: the chat continues the stored session.
    await smoke.run('project.close', { id: duplexId });
    smoke.check('closing the project kills the process', await smoke.until(() => !alive(starts()[1].pid), 30_000));
    await openAssistant();
    smoke.check('the reopened chat shows the earlier messages again', (await smoke.waitFor(`${panel} [data-testid=assistant-item][data-kind=assistant]`, 5000, 'Back on the same session.')) && (await smoke.count(`${panel} [data-testid=assistant-item][data-kind=user]`)) >= 4);
    writeScript({ expectResume: 'smoke-sess-1', replay: [{ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Replayed twice if this shows' }] } }], messages: [[{ text: 'Still here.' }]] });
    await send('Still there?');
    smoke.check('and its first message resumes it', (await smoke.waitFor(`${panel} [data-testid=assistant-item][data-kind=assistant]`, 30_000, 'Still here.')) && starts().length === 3 && starts()[2].resume === 'smoke-sess-1');
    smoke.check('history the stream replays is not shown twice', (await smoke.count(`${panel} [data-testid=assistant-item]`)) > 0 && !(await smoke.text(`${panel} [data-testid=assistant-log]`))?.includes('Replayed twice'));
    await smoke.gone(`${panel} [data-testid=assistant-stop]`, 3000);

    // The model and effort chosen in Settings reach the next message's process, which continues the session.
    await openSettings();
    // Typed and committed with Enter, as a user does; the field saves on Enter or blur, never while typing.
    // `smoke.click` is a DOM click, which does not focus an input: focus it so Enter reaches it.
    // The Model field appears once the probe has answered, which can take many seconds on a busy machine (30 s budget).
    smoke.check('the Model field is shown once the probe answered', await smoke.waitFor('[data-testid=settings-claude-code-model]', 30_000));
    await smoke.js(`document.querySelector('[data-testid=settings-claude-code-model]').focus()`);
    await smoke.fill('[data-testid=settings-claude-code-model]', 'opus');
    await smoke.key('Return');
    smoke.check('the model is saved when Enter commits it', await smoke.until(() => smoke.host.config.get().ai.claudeCodeModel === 'opus'), smoke.host.config.get().ai.claudeCodeModel);
    await smoke.fill('[data-testid=settings-claude-code-effort]', 'high');
    smoke.check('the model and effort chosen in Settings are stored', await smoke.until(() => smoke.host.config.get().ai.claudeCodeModel === 'opus' && smoke.host.config.get().ai.claudeCodeEffort === 'high'), smoke.host.config.get().ai);
    await smoke.js(`document.querySelector('[data-section="ai"]').scrollIntoView({ block: 'start' })`);
    await smoke.shots('33-settings-claude-code-model');
    await openAssistant();
    smoke.check('the chat header names them', await smoke.waitFor(`${panel} [data-testid=assistant-model]`, 3000, 'Claude Code 9.9.9 · opus · high effort'), await smoke.text(`${panel} [data-testid=assistant-model]`));
    writeScript({ expectResume: 'smoke-sess-1', messages: [[{ text: 'Now on opus.' }]] });
    await send('Which model?');
    smoke.check('the next message starts Claude Code with --model and --effort, on the same session', (await smoke.waitFor(`${panel} [data-testid=assistant-item][data-kind=assistant]`, 30_000, 'Now on opus.')) && starts().length === 4 && starts()[3].model === 'opus' && starts()[3].effort === 'high' && starts()[3].resume === 'smoke-sess-1', starts().map((s) => [s.model, s.effort, s.resume]));
    smoke.check('and the process started without them is gone', await smoke.until(() => !alive(starts()[2].pid), 30_000));
    await smoke.gone(`${panel} [data-testid=assistant-stop]`, 3000);
    await smoke.click(`${panel} [data-testid=assistant-clear]`);
    smoke.check('Clear forgets the session', (await smoke.waitFor(`${panel} [data-testid=assistant-intro]:not([data-resumed])`, 3000)) && (await smoke.until(async () => (await run<{ sessionId: string | null }>('assistant.state')).sessionId === null)));
    smoke.check('and the process with it', await smoke.until(() => !alive(starts()[3].pid), 30_000));
  } finally {
    delete process.env.FAKE_CLAUDE_SCRIPT;
    delete process.env.FAKE_CLAUDE_LOG;
    delete process.env.FAKE_CLAUDE_LOGGED_OUT;
    await smoke.run('config.update', { patch: { ai: { provider: 'api', claudeCodePath: '', claudeCodeModel: '', claudeCodeEffort: '' }, mcp: { enabled: true } } });
  }
}
