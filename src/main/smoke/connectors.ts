import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { rectPath, type OpenProject } from '@studio/core';
import type { Smoke } from './harness';

const text = (result: unknown) => JSON.parse((result as { content: { text: string }[] }).content[0].text) as Record<string, unknown>;

type Slab = { area: number; slabs: { source: string; area: number }[]; openings: { kind: string; area: number }[] };

/** The box both floors share: 10 × 8 m of walls 200 thick on their centre lines, so the automatic slab is 10.2 × 8.2 m. */
export const DUPLEX_SLAB = 10200 * 8200;
export const DUPLEX_STAIR = { axis: { closed: false, v: [{ p: [2000, 1000] }, { p: [2000, 4750] }] }, width: 1000 };
export const DUPLEX_LIFT = { at: [7500, 5500] as [number, number], shaft: { w: 2000, d: 2200 }, car: { w: 1100, d: 1400 } };

/**
 * Vertical circulation through commands and MCP: a two-storey building with a stair and an elevator,
 * their derived numbers, and the stairwell and shaft cut out of the upper slab. Returns the project
 * for the UI section, closed.
 */
export async function smokeConnectors(smoke: Smoke): Promise<{ duplexId: string }> {
  smoke.section('connectors');
  const duplex = await smoke.run<OpenProject>('project.create', { name: 'Duplex' });
  const projectId = duplex.id;
  const run = <T = unknown>(id: string, input: unknown = {}) => smoke.run<T>(id, input, { projectId });
  const ground = smoke.host.projects.session(projectId)!.doc.building.groundLevelId;
  const upper = (await run<{ id: string }>('building.level.add', { name: 'Upper floor' })).id;
  for (const levelId of [ground, upper]) {
    await run('plan.apply', {
      label: 'Walls and slab',
      steps: [
        { command: 'plan.entity.add', input: { levelId, entity: { type: 'wall', path: rectPath(0, 0, 10000, 8000), thickness: 200 } } },
        { command: 'plan.entity.add', input: { levelId, entity: { type: 'slab', source: { k: 'auto' } } } },
      ],
    });
  }
  const before = await run<Slab>('plan.slab', { levelId: upper });
  smoke.check('before any connector the upper slab is the whole floor', before.area === DUPLEX_SLAB && before.openings.length === 0, before);

  const stair = (await run<{ id: string }>('building.connector.add', { connector: { kind: 'stair', shape: 'straight', bottom: { levelId: ground }, top: { levelId: upper }, ...DUPLEX_STAIR } })).id;
  const lift = (await run<{ id: string }>('building.connector.add', { connector: { kind: 'elevator', ...DUPLEX_LIFT, stops: [{ levelId: ground }, { levelId: upper, door: 'back' }] } })).id;
  const upperSlab = await run<Slab>('plan.slab', { levelId: upper });
  const groundSlab = await run<Slab>('plan.slab', { levelId: ground });
  smoke.check('the stairwell and the shaft are cut out of the upper slab', upperSlab.area === DUPLEX_SLAB - 1000 * 3750 - 2000 * 2200 && upperSlab.openings.map((o) => o.kind).sort().join() === 'elevator,stair', upperSlab);
  smoke.check('the ground slab, where they start, stays whole', groundSlab.area === DUPLEX_SLAB && groundSlab.openings.length === 0, groundSlab);

  smoke.section('connectors over MCP');
  const status = await smoke.run<{ url: string }>('mcp.status');
  const client = new Client({ name: 'smoke-stair-agent', version: '1.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${status.url}?project=${projectId}`)));
  const building = text(await client.callTool({ name: 'building_get', arguments: {} })) as { connectors: { id: string; derived: { risers?: number; riserHeight?: number; treadDepth?: number; cuts: string[]; stops?: { door: string }[] } }[] };
  const stairNumbers = building.connectors.find((c) => c.id === stair)?.derived;
  smoke.check('an agent reads the stair as 16 risers of 187.5 mm with 250 mm treads, cutting the upper floor', stairNumbers?.risers === 16 && stairNumbers.riserHeight === 187.5 && stairNumbers.treadDepth === 250 && stairNumbers.cuts.join() === upper, stairNumbers);
  smoke.check('and the elevator with its stops bottom to top', building.connectors.find((c) => c.id === lift)?.derived.stops?.map((s) => s.door).join() === 'front,back');
  const slab = text(await client.callTool({ name: 'plan_slab', arguments: { levelId: upper } })) as unknown as Slab;
  smoke.check('an agent reads the upper slab with its two openings', slab.area === upperSlab.area && slab.openings.length === 2, slab);
  await run('building.level.update', { levelId: ground, height: 3400 });
  const taller = text(await client.callTool({ name: 'building_get', arguments: {} })) as typeof building;
  const regenerated = taller.connectors.find((c) => c.id === stair)?.derived;
  smoke.check('a taller ground floor regenerates the stair: 18 risers', regenerated?.risers === 18, regenerated);
  await run('edit.undo');
  await client.close();
  await smoke.run('project.close', { id: projectId });
  return { duplexId: projectId };
}
