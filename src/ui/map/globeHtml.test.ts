import { buildGlobeHtml } from './globeHtml';
import { ROUTE_STYLE, MARKER_STYLE } from './routeStyle';

const html = buildGlobeHtml({
  routeLiteral: '{"stops":[],"legs":[]}',
  styleUrl: 'https://example.test/style.json',
  bottomPadding: 0,
});

describe('globe look', () => {
  it('draws the route in our own colour, not the white-dashed-on-satellite convention', () => {
    expect(ROUTE_STYLE.color).not.toBe('#ffffff');
    expect(ROUTE_STYLE.dasharray).toBeNull();
    expect(html).toContain(`'line-color': '${ROUTE_STYLE.color}'`);
  });

  it('does not dash the route line', () => {
    expect(html).not.toContain('line-dasharray');
  });

  it('frames stop photos as rounded squares, not circles', () => {
    expect(MARKER_STYLE.radiusPx).toBeLessThan(MARKER_STYLE.sizePx / 2);
    expect(html).toContain(`border-radius: ${MARKER_STYLE.radiusPx}px`);
    expect(html).toContain(`width: ${MARKER_STYLE.sizePx}px`);
  });
});
