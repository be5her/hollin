import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { Smoke } from './harness';

type Snapshot = { mimeType: string; data: string; levelId: string; levelName: string; width: number; height: number };

const isPng = (bytes: Buffer) => bytes.length > 1000 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;

/**
 * `view.snapshot`: main asks the window to draw a level and gets a PNG back, through commands and as
 * image content over MCP; a column spanning up from the ground floor shows on the upper floor's
 * snapshot; a level with nothing drawn is refused.
 */
export async function smokeSnapshotUi(smoke: Smoke, duplexId: string): Promise<void> {
  smoke.section('snapshots');
  const doc = () => smoke.host.projects.session(duplexId)!.doc;
  const ground = doc().building.groundLevelId;
  const upper = doc().building.stack[1];
  const run = <T = unknown>(id: string, input: unknown = {}) => smoke.run<T>(id, input, { projectId: duplexId });

  const groundShot = await run<Snapshot>('view.snapshot', {});
  const groundPng = Buffer.from(groundShot.data, 'base64');
  smoke.check('view.snapshot draws the ground floor into a PNG by default', groundShot.mimeType === 'image/png' && groundShot.levelId === ground && groundShot.width === 800 && groundShot.height === 600 && isPng(groundPng), { ...groundShot, data: `${groundPng.length} bytes` });
  const upperShot = await run<Snapshot>('view.snapshot', { levelId: upper, width: 400, height: 300 });
  const upperPng = Buffer.from(upperShot.data, 'base64');
  smoke.check('and the upper floor at the asked size, which looks different (the stairwell and the shaft)', upperShot.levelName === 'Upper floor' && isPng(upperPng) && !upperPng.equals(groundPng), { bytes: upperPng.length });

  // A column from the ground floor up through the upper floor shows on the upper floor's snapshot.
  const column = await run<{ id: string }>('plan.entity.add', { levelId: ground, entity: { type: 'column', at: [5000, 4000], shape: { k: 'rect', w: 600, d: 600 }, span: { topLevelId: upper, topOffset: 3000 } } });
  const withColumn = Buffer.from((await run<Snapshot>('view.snapshot', { levelId: upper, width: 400, height: 300 })).data, 'base64');
  smoke.check('a column spanning up from the ground floor shows on the upper floor snapshot', isPng(withColumn) && !withColumn.equals(upperPng), { before: upperPng.length, after: withColumn.length, column: column.id });
  await run('edit.undo');

  const status = await smoke.run<{ url: string }>('mcp.status');
  const client = new Client({ name: 'smoke-viewer', version: '1.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${status.url}?project=${duplexId}`)));
  const result = (await client.callTool({ name: 'view_snapshot', arguments: { levelId: upper } })) as { isError?: boolean; content: { type: string; data?: string; mimeType?: string; text?: string }[] };
  const image = result.content[0];
  const rest = result.content[1]?.text ? (JSON.parse(result.content[1].text) as { levelId: string; width: number }) : undefined;
  smoke.check('an agent gets the snapshot as image content over MCP, the level as text', !result.isError && image?.type === 'image' && image.mimeType === 'image/png' && isPng(Buffer.from(image.data ?? '', 'base64')) && rest?.levelId === upper && rest.width === 800, { types: result.content.map((c) => c.type), rest });
  await client.close();

  const blank = await smoke.run<{ id: string }>('project.create', { name: 'Blank' });
  await smoke.expectError('a level with nothing drawn has no snapshot', 'view.snapshot', {}, 'NOT_FOUND', { projectId: blank.id });
  await smoke.run('project.close', { id: blank.id });
  await smoke.run('project.trash', { id: blank.id });
}
