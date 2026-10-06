import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { type Smoke } from './harness';
import { canvas, canvasAttr, tab } from './plan-canvas';

/** The rules engine with real input: a warning appears live, clicking it shows the level and selects the stair, fixing it clears the warning; a height change regenerates the risers; an agent reads the warnings over MCP. */
export async function smokeRulesUi(smoke: Smoke, duplexId: string): Promise<void> {
  smoke.section('rules and warnings');
  const doc = () => smoke.host.projects.session(duplexId)!.doc;
  const ground = doc().building.groundLevelId;
  const upper = doc().building.stack[1];
  // The original stair of the Duplex, whose walk line starts at x = 2000.
  const stair = Object.values(doc().connectors).find((c) => c.kind === 'stair' && (c as { axis: { v: { p: readonly number[] }[] } }).axis.v[0].p[0] === 2000)!;
  const run = <T = unknown>(id: string, input: unknown = {}) => smoke.run<T>(id, input, { projectId: duplexId });
  const rulesEvents = (from: number) => smoke.eventsSince(from, 'rules.changed') as { projectId: string; count: number }[];

  await smoke.click(`${tab} [data-testid=right-tab-warnings]`);
  smoke.check('the Warnings panel opens with nothing to report', (await smoke.waitFor(`${tab} [data-testid=warnings-panel]`)) && (await smoke.waitFor(`${tab} [data-testid=warnings-empty]`)) && (await smoke.count(`${tab} [data-testid=right-badge-warnings]`)) === 0);
  // Show the upper floor first, so the warning's click has a level to switch from.
  await smoke.fill(`${tab} [data-testid=plan-level]`, upper);
  await smoke.until(async () => (await canvasAttr(smoke, 'frameLevel')) === upper);
  const mark = smoke.events.length;
  await run('building.connector.update', { id: stair.id, set: { riser: { count: 8 } } });
  // Eight risers over 3 m: 375 mm each, too high and uncomfortable, two warnings on the one stair.
  smoke.check('eight risers over 3 m raise a warning as soon as the change settles', await smoke.waitFor(`${tab} [data-testid=warning-row][data-rule=stair-limits]`, 3000), await smoke.text(`${tab} [data-testid=warnings-panel]`));
  smoke.check('the host announced the new count once', (await smoke.until(() => rulesEvents(mark).length >= 1)) && rulesEvents(mark).at(-1)?.count === 2 && rulesEvents(mark).length === 1, rulesEvents(mark));
  smoke.check('the Warnings tab shows the count', await smoke.waitFor(`${tab} [data-testid=right-badge-warnings]`, 3000, '2'));
  await smoke.shots('26-warnings');
  await smoke.click(`${tab} [data-testid=warning-row][data-rule=stair-limits]`);
  smoke.check('clicking the warning shows the ground floor and selects the stair', (await smoke.until(async () => (await canvasAttr(smoke, 'frameLevel')) === ground)) && (await smoke.until(async () => (await canvasAttr(smoke, 'selection')) === stair.id)), { level: await canvasAttr(smoke, 'level'), selection: await canvasAttr(smoke, 'selection') });
  smoke.check('the Properties panel shows the stair with its broken limit', (await smoke.click(`${tab} [data-testid=right-tab-properties]`)) && (await smoke.waitFor(`${tab} [data-testid=connector-broken]`, 3000)));
  await smoke.click(`${tab} [data-testid=right-tab-warnings]`);

  smoke.section('rules over MCP');
  const status = await smoke.run<{ url: string }>('mcp.status');
  const agent = new Client({ name: 'smoke-rules-agent', version: '1.0' });
  await agent.connect(new StreamableHTTPClientTransport(new URL(`${status.url}?project=${duplexId}`)));
  const read = JSON.parse(((await agent.callTool({ name: 'rules_check', arguments: {} })).content as { text: string }[])[0].text) as { count: number; warnings: { rule: string; target: { id: string } }[] };
  smoke.check('an agent reads the warnings with their rule and target', read.count === 2 && read.warnings.every((w) => w.rule === 'stair-limits' && w.target.id === stair.id), read);
  await agent.close();

  const before = smoke.events.length;
  await run('building.connector.update', { id: stair.id, set: { riser: {} } });
  smoke.check('fixing the stair clears the warning and the badge', (await smoke.waitFor(`${tab} [data-testid=warnings-empty]`, 3000)) && (await smoke.until(async () => (await smoke.count(`${tab} [data-testid=right-badge-warnings]`)) === 0)) && rulesEvents(before).at(-1)?.count === 0, rulesEvents(before));
  const taller = await run<{ levels: { id: string; height: number }[]; connectors: { id: string; derived: { risers: number } }[] }>('building.level.update', { levelId: ground, height: 3400 }).then(() => run<{ levels: { id: string; height: number }[]; connectors: { id: string; derived: { risers: number } }[] }>('building.get'));
  smoke.check('a taller ground floor regenerates the stair with 18 risers', taller.connectors.find((c) => c.id === stair.id)?.derived.risers === 18, taller.connectors.find((c) => c.id === stair.id)?.derived);
  smoke.check('and the stair, now too shallow, is flagged live', await smoke.waitFor(`${tab} [data-testid=warning-row][data-rule=stair-limits]`, 3000));
  await run('edit.undo');
  smoke.check('undoing the height clears it again', await smoke.waitFor(`${tab} [data-testid=warnings-empty]`, 3000));
  await smoke.click(`${tab} [data-testid=right-tab-properties]`);
  void canvas;
}
