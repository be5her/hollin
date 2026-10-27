import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { wait, type Smoke } from './harness';
import { canvas, canvasAttr, tab, view } from './plan-canvas';

/** Stairs, elevators and an escalator on the plan with real input: the stairwell and shaft cut out of the upper slab. */
export async function smokeConnectorsUi(smoke: Smoke, duplexId: string): Promise<void> {
  smoke.section('connectors on the plan');
  const doc = () => smoke.host.projects.session(duplexId)!.doc;
  await smoke.run('project.open', { id: duplexId });
  await smoke.click(`${tab} [data-testid=center-tab-plan]`);
  smoke.check('the duplex opens on its plan', await smoke.waitFor(canvas));
  const ground = doc().building.groundLevelId;
  const upper = doc().building.stack[1];

  const showLevel = async (levelId: string) => {
    // The switcher lists the levels once the document has arrived; a value set before that is dropped.
    await smoke.waitFor(`${tab} [data-testid=plan-level] option[value="${levelId}"]`);
    await smoke.fill(`${tab} [data-testid=plan-level]`, levelId);
    await smoke.until(async () => (await canvasAttr(smoke, 'level')) === levelId);
    // The switcher changes before the frame does: sample pixels only once a frame of this level has been drawn.
    smoke.check(`the plan shows ${doc().levels[levelId].name}`, await smoke.until(async () => (await canvasAttr(smoke, 'frameLevel')) === levelId), { level: await canvasAttr(smoke, 'level'), frameLevel: await canvasAttr(smoke, 'frameLevel') });
    await smoke.click(`${tab} [data-testid=plan-zoom-fit]`);
    await wait(150);
    return view(smoke);
  };

  // A point in the stairwell clear of its tread lines, one in the shaft clear of the car's cross, and one on the floor, all off the grid lines.
  const inStairwell: [number, number] = [2345, 2617];
  const inShaft: [number, number] = [6713, 4589];
  const onFloor: [number, number] = [5123, 1937];
  let v = await showLevel(upper);
  const upperFloor = await v.pixel(onFloor);
  const upperWell = await v.pixel(inStairwell);
  const upperShaft = await v.pixel(inShaft);
  v = await showLevel(ground);
  const groundFloor = await v.pixel(onFloor);
  const groundWell = await v.pixel(inStairwell);
  smoke.check('the upper slab is painted, with the stairwell cut out of it', upperFloor !== null && upperWell !== null && upperWell !== upperFloor, { upperFloor, upperWell });
  smoke.check('and the elevator shaft too', upperShaft !== null && upperShaft !== upperFloor, { upperFloor, upperShaft });
  smoke.check('the ground slab, where the stair starts, is not cut', groundWell === groundFloor && groundFloor === upperFloor, { groundFloor, groundWell });
  await showLevel(upper);
  await smoke.shots('20-stairwell');

  smoke.section('connector symbols');
  const stairId = Object.values(doc().connectors).find((c) => c.kind === 'stair')!.id;
  // The first tread line runs along the stair's bottom edge (y = 1000); the elevator's door mark sits on the shaft's front side below (y = 4400) and its back side above (y = 6600).
  const firstTread: [number, number] = [2345, 1000];
  v = await showLevel(ground);
  smoke.check('the ground floor shows both connectors', (await canvasAttr(smoke, 'connectors')) === '2', await canvasAttr(smoke, 'connectors'));
  const groundTread = await v.pixel(firstTread);
  const groundDoor = await v.pixel([7500, 4400]);
  const groundBack = await v.pixel([7500, 6600]);
  smoke.check("the stair's treads are drawn where it starts", groundTread !== null && groundTread !== groundFloor, { groundTread, groundFloor });
  smoke.check('the elevator door is marked on the side it opens at the ground floor', groundDoor !== groundBack, { groundDoor, groundBack });
  await smoke.shots('21-stair-up');
  v = await showLevel(upper);
  smoke.check('the upper floor shows both connectors', (await canvasAttr(smoke, 'connectors')) === '2');
  const upperTread = await v.pixel(firstTread);
  const upperBack = await v.pixel([7500, 6600]);
  smoke.check('the stair is drawn where it arrives, over its stairwell', upperTread !== null && upperTread !== upperWell, { upperTread, upperWell });
  smoke.check('and the elevator door on its back side there', upperBack !== groundBack, { upperBack, groundBack });
  await smoke.shots('22-stair-down');

  smoke.section('editing connectors on the plan');
  v = await showLevel(ground);
  const axis = () => (doc().connectors[stairId] as { axis: { v: { p: readonly number[] }[] } }).axis.v.map((x) => x.p.map((n) => Math.round(n / 5) * 5).join(',')).join(' ');
  const inside = v.at([2300, 2617]);
  await smoke.clickAt(inside.x, inside.y);
  smoke.check('a click on the stair selects it', await smoke.until(async () => (await canvasAttr(smoke, 'selection')) === stairId), await canvasAttr(smoke, 'selection'));
  smoke.check('the Properties panel shows the stair with its derived numbers', (await smoke.waitFor(`${tab} [data-testid=properties-title]`, 3000, 'Stair')) && (await smoke.waitFor(`${tab} [data-testid=connector-derived]`, 3000, '16 risers')));
  await smoke.shots('23-stair-selected');
  // The pointer lands on whole pixels, so a drag ends where that pixel maps to: within a pixel of the asked point.
  const axisPoints = () => (doc().connectors[stairId] as { axis: { v: { p: readonly [number, number] }[] } }).axis.v.map((x) => x.p);
  const within = (p: readonly [number, number], q: readonly [number, number], tol: number) => Math.abs(p[0] - q[0]) <= tol && Math.abs(p[1] - q[1]) <= tol;
  const pixel = 1 / v.cam.scale + 0.01;
  // Alt keeps snapping out of the way, so the move is what the pointer did.
  const moveTo = v.at([3300, 2617]);
  await smoke.dragAt(inside, moveTo, { modifiers: ['alt'] });
  smoke.check('dragging the stair moves it on the plan', await smoke.until(() => within(axisPoints()[0], [3000, 1000], pixel) && within(axisPoints()[1], [3000, 4750], pixel)), axis());
  await smoke.key('Z', ['control']);
  smoke.check('Ctrl+Z puts it back', await smoke.until(() => axis() === '2000,1000 2000,4750'), axis());
  await smoke.clickAt(inside.x, inside.y);
  await smoke.until(async () => (await canvasAttr(smoke, 'selection')) === stairId);
  const top = v.at([2000, 4750]);
  const further = v.at([2000, 5250]);
  await smoke.dragAt(top, further, { modifiers: ['alt'] });
  smoke.check("dragging the top of the stair's walk line lengthens it", await smoke.until(() => within(axisPoints()[1], [2000, 5250], pixel) && within(axisPoints()[0], [2000, 1000], 0.01)), axis());
  smoke.check('and regenerates its treads', await smoke.waitFor(`${tab} [data-testid=connector-derived]`, 3000, '16 risers'));
  await smoke.key('Z', ['control']);
  await smoke.until(() => axis() === '2000,1000 2000,4750');
  await smoke.clickAt(inside.x, inside.y);
  await smoke.key('Delete');
  smoke.check('Delete removes the stair', await smoke.until(() => !doc().connectors[stairId]));
  await smoke.key('Z', ['control']);
  smoke.check('and Ctrl+Z brings it back', await smoke.until(() => Boolean(doc().connectors[stairId])));
  await smoke.key('Escape');

  smoke.section('drawing connectors');
  const connectorIds = () => new Set(Object.keys(doc().connectors));
  let known = connectorIds();
  const newConnector = () => Object.values(doc().connectors).find((c) => !known.has(c.id));
  const near = (p: readonly number[], q: readonly number[]) => Math.abs(p[0] - q[0]) < 2 / v.cam.scale && Math.abs(p[1] - q[1]) < 2 / v.cam.scale;
  await smoke.clickAt(v.at([5123, 1937]).x, v.at([5123, 1937]).y);
  await smoke.click(`${tab} [data-testid=tool-stair]`);
  smoke.check('the stair tool shows its options', (await smoke.waitFor(`${tab} [data-testid=tool-options]`)) && (await canvasAttr(smoke, 'tool')) === 'stair');
  await smoke.fill(`${tab} [data-testid=stair-shape]`, 'l');
  smoke.check('the levels default to this floor and the one above', (await smoke.js<string>(`document.querySelector('${tab} [data-testid=connector-from]').value`)) === ground && (await smoke.js<string>(`document.querySelector('${tab} [data-testid=connector-to]').value`)) === upper);
  // The options bar changed the canvas height: measure again. An L from (4000, 1000) up to its corner and right to (5850, 4000), long enough for 14 treads within the limits with room to spare (clicks land on whole pixels); tracking keeps the flights straight.
  v = await view(smoke);
  for (const p of [[4000, 1000], [4000, 4000], [5850, 4000]] as const) await smoke.clickAt(v.at(p).x, v.at(p).y);
  smoke.check('three clicks draw an L stair to the upper floor', (await smoke.until(() => newConnector()?.kind === 'stair')) && newConnector()!.kind === 'stair' && (newConnector() as { shape: string }).shape === 'l' && (newConnector() as { bottom: { levelId: string }; top: { levelId: string } }).top.levelId === upper, newConnector());
  const drawn = newConnector() as { axis: { v: { p: readonly number[] }[] } };
  smoke.check('its corner is where it was clicked, the flights exactly straight', drawn.axis.v.length === 3 && near(drawn.axis.v[1].p, [4000, 4000]) && drawn.axis.v[0].p[0] === drawn.axis.v[1].p[0] && drawn.axis.v[1].p[1] === drawn.axis.v[2].p[1], drawn.axis.v);
  smoke.check('the stair it makes is within the limits', (await smoke.waitFor(`${tab} [data-testid=connector-derived]`, 3000, '16 risers')) && (await smoke.count(`${tab} [data-testid=connector-broken]`)) === 0, await smoke.text(`${tab} [data-testid=connector-derived]`));
  smoke.check('the panel shows the new stair', await smoke.waitFor(`${tab} [data-testid=properties-title]`, 3000, 'Stair'));
  await smoke.shots('24-stair-tool');
  known = connectorIds();
  await smoke.key('Escape');
  await smoke.until(async () => (await canvasAttr(smoke, 'tool')) === 'select');
  await smoke.key('E');
  smoke.check('E picks the elevator tool', await smoke.until(async () => (await canvasAttr(smoke, 'tool')) === 'elevator'));
  v = await view(smoke);
  await smoke.clickAt(v.at([4000, 6500]).x, v.at([4000, 6500]).y);
  smoke.check('a click places an elevator stopping at both floors', (await smoke.until(() => newConnector()?.kind === 'elevator')) && near((newConnector() as { at: readonly number[] }).at, [4000, 6500]) && (newConnector() as { stops: { levelId: string }[] }).stops.map((s) => s.levelId).join() === [ground, upper].join(), newConnector());
  known = connectorIds();
  await smoke.key('Escape');
  await smoke.until(async () => (await canvasAttr(smoke, 'tool')) === 'select');
  const columns = () => Object.values(doc().levelData[ground].entities).filter((e) => e.type === 'column') as { at: readonly number[]; shape: { k: string } }[];
  await smoke.key('C');
  smoke.check('C picks the column tool', await smoke.until(async () => (await canvasAttr(smoke, 'tool')) === 'column'));
  v = await view(smoke);
  // Just inside the left wall's inner face (x = 100): the column snaps onto the face.
  await smoke.clickAt(v.at([130, 3000]).x, v.at([130, 3000]).y);
  smoke.check('a click places a column snapped to the wall face', (await smoke.until(() => columns().length === 1)) && columns()[0].at[0] === 100 && Math.abs(columns()[0].at[1] - 3000) < 2 / v.cam.scale && columns()[0].shape.k === 'rect', columns()[0]);
  await smoke.key('Escape');
  await smoke.until(async () => (await canvasAttr(smoke, 'tool')) === 'select');

  smoke.section('connector intents over MCP');
  const status = await smoke.run<{ url: string }>('mcp.status');
  const agent = new Client({ name: 'smoke-stair-intent', version: '1.0' });
  await agent.connect(new StreamableHTTPClientTransport(new URL(`${status.url}?project=${duplexId}`)));
  const added = await agent.callTool({ name: 'building_connector_add', arguments: { connector: { kind: 'stair', shape: 'u', from: [8000, 1000], to: [8000, 3000], bottomLevelId: ground, topLevelId: upper, width: 1000, turn: 'right' } } });
  const addedId = added.isError ? '' : (JSON.parse((added.content as { text: string }[])[0].text) as { id: string }).id;
  const laid = doc().connectors[addedId] as { axis: { v: unknown[] } } | undefined;
  smoke.check('an agent asks for a U stair by two points and gets its walk line laid out', !added.isError && laid?.axis.v.length === 4, added.isError ? added.content : laid?.axis);
  const described = JSON.parse(((await agent.callTool({ name: 'building_get', arguments: {} })).content as { text: string }[])[0].text) as { connectors: { id: string; derived: { risers: number; flights: unknown[] } }[] };
  smoke.check('and reads it back as 16 risers in two flights', described.connectors.find((c) => c.id === addedId)?.derived.risers === 16 && described.connectors.find((c) => c.id === addedId)?.derived.flights.length === 2, described.connectors.find((c) => c.id === addedId)?.derived);
  await agent.close();
  smoke.check('the agent\'s stair appears on the plan', await smoke.until(async () => (await canvasAttr(smoke, 'connectors')) === '5'), await canvasAttr(smoke, 'connectors'));
  await smoke.shots('25-connectors-drawn');

  smoke.section('the escalator tool');
  known = connectorIds();
  const hint = () => smoke.text(`${tab} [data-testid=plan-hint]`);
  smoke.check('the toolbar offers the escalator with its shortcut', (await smoke.js<string | null>(`document.querySelector('${tab} [data-testid=tool-escalator]')?.getAttribute('title') ?? null`)) === 'Escalator (Shift+E)');
  v = await view(smoke);
  await smoke.clickAt(v.at(onFloor).x, v.at(onFloor).y);
  await smoke.key('E', ['shift']);
  smoke.check('Shift+E picks the escalator tool and shows its options', (await smoke.until(async () => (await canvasAttr(smoke, 'tool')) === 'escalator')) && (await smoke.waitFor(`${tab} [data-testid=escalator-width]`)), await canvasAttr(smoke, 'tool'));
  smoke.check('its levels default to this floor and the one above', (await smoke.js<string>(`document.querySelector('${tab} [data-testid=connector-from]').value`)) === ground && (await smoke.js<string>(`document.querySelector('${tab} [data-testid=connector-to]').value`)) === upper);
  // A width typed in the options bar, in any unit, is kept in the settings.
  await smoke.js(`document.querySelector('${tab} [data-testid=escalator-width]').focus()`);
  await smoke.fill(`${tab} [data-testid=escalator-width]`, '1.2m');
  await smoke.js(`document.querySelector('${tab} [data-testid=escalator-width]').blur()`);
  smoke.check('a width typed in the options is kept in the settings', await smoke.until(() => smoke.host.config.get().editor.escalatorWidth === 1200), smoke.host.config.get().editor.escalatorWidth);
  // The options bar changed the canvas height: measure again. The foot is clicked with Alt, so it lands where the pointer is;
  // the direction is aimed 30 mm off due north 3 m away (well within 3°), so tracking holds it at exactly 90°.
  v = await view(smoke);
  const foot: [number, number] = [1000, 1500];
  await smoke.clickAt(v.at(foot).x, v.at(foot).y, { modifiers: ['alt'] });
  smoke.check('the first click sets the foot and asks for the direction', await smoke.until(async () => (await hint())?.includes('direction it rises towards') === true), await hint());
  const aim = v.at([1030, 4500]);
  await smoke.mouseMove(aim.x + 1, aim.y);
  await smoke.mouseMove(aim.x, aim.y);
  smoke.check('the preview gives its length', await smoke.until(async () => (await hint())?.includes('mm long') === true), await hint());
  await smoke.shots('26-escalator-tool');
  await smoke.clickAt(aim.x, aim.y);
  smoke.check('the second click places an escalator rising due north to the upper floor', (await smoke.until(() => newConnector()?.kind === 'escalator')) && newConnector()!.kind === 'escalator', newConnector());
  const escalator = newConnector() as { id: string; at: readonly number[]; direction: number; width: number; bottom: { levelId: string }; top: { levelId: string } } | undefined;
  smoke.check('at the foot clicked, tracked to exactly 90°, as wide as the options say', !!escalator && near(escalator.at, foot) && escalator.direction === 90 && escalator.width === 1200 && escalator.bottom.levelId === ground && escalator.top.levelId === upper, escalator);
  smoke.check('the panel shows the new escalator', await smoke.waitFor(`${tab} [data-testid=properties-title]`, 3000, 'Escalator'), await smoke.text(`${tab} [data-testid=properties-title]`));
  smoke.check('the plan draws it', await smoke.until(async () => (await canvasAttr(smoke, 'connectors')) === '6'), await canvasAttr(smoke, 'connectors'));
  await smoke.key('Escape');
  await smoke.until(async () => (await canvasAttr(smoke, 'tool')) === 'select');
  // Leave the duplex as the later sections expect it: the escalator goes again.
  if (escalator) await smoke.run('building.connector.remove', { id: escalator.id }, { projectId: duplexId });
  smoke.check('and it goes again', await smoke.until(async () => (await canvasAttr(smoke, 'connectors')) === '5'), await canvasAttr(smoke, 'connectors'));
}
