import { describe, expect, it } from 'vitest';
import { triangulatePolygons } from './clip';
import { polygonArea, polygonContains, type Polygon } from './polygon';

const centroid = (t: Polygon): [number, number] => [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3];

describe('triangulatePolygons', () => {
  it('leaves the holes empty when an outline carries a zero-width spike', () => {
    // A wall top cap as a difference left it (Home, the ground floor under a taller boundary wall):
    // the outline runs out along the front line to x -28830 and straight back, a few µm off true.
    const outline: Polygon = [
      [-200, 200], [-8197.372, 200], [-8197.372, 6581.144], [-10752.172, 6581.144], [-10752.172, 22481.144], [-200.007, 22481.144], [-200.007, 22681.144], [-4956.772, 22681.144],
      [-4956.772, 29602.836], [-200.01, 30336.803], [-28830.88, 25919.071], [-20996.772, 27127.87], [-20996.772, 22481.144], [-20996.772, 0], [-200, 0],
    ];
    const holes: Polygon[] = [
      [[-8916.772, 28991.81], [-5156.772, 29571.976], [-5156.772, 22681.144], [-8916.772, 22681.144]],
      [[-12876.772, 28380.783], [-9116.772, 28960.95], [-9116.772, 22681.144], [-12876.772, 22681.144]],
      [[-16836.772, 27769.757], [-13076.772, 28349.923], [-13076.772, 22681.144], [-16836.772, 22681.144]],
      [[-20796.772, 27158.73], [-17036.772, 27738.897], [-17036.772, 22681.144], [-20796.772, 22681.144]],
      [[-20796.772, 22481.144], [-10952.172, 22481.144], [-10952.172, 6581.144], [-13428.872, 6581.144], [-13428.872, 200], [-20796.772, 200]],
      [[-13228.872, 6381.144], [-8397.372, 6381.144], [-8397.372, 200], [-13228.872, 200]],
    ];
    const polys = [outline, ...holes];
    const net = polys.reduce((s, p) => s + polygonArea(p), 0);
    const triangles = triangulatePolygons(polys);
    expect(triangles.length).toBeGreaterThan(0);
    expect(triangles.reduce((s, t) => s + polygonArea(t), 0)).toBeCloseTo(net, -2);
    expect(triangles.filter((t) => holes.some((h) => polygonContains(h, centroid(t))))).toEqual([]);
  });
});
