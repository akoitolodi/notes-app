import { describe, it, expect } from 'vitest';
import { strokeHitsPoint, resolveStrokeColor } from '../src/components/StrokeLayer.jsx';

describe('StrokeLayer geometry & adaptive ink', () => {
  it('erases the middle segment of a line or arrow, not just endpoints', () => {
    const lineStroke = {
      tool: 'arrow',
      width: 4,
      points: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ],
    };
    // Midpoint (100, 3) is far from endpoints (0,0) and (200,0) but right on the segment
    expect(strokeHitsPoint(lineStroke, { x: 100, y: 3 }, 10)).toBe(true);
    expect(strokeHitsPoint(lineStroke, { x: 100, y: 40 }, 10)).toBe(false);
  });

  it('erases a text label anywhere across its bounding box', () => {
    const textStroke = {
      tool: 'text',
      fontSize: 20,
      text: 'Mitochondria',
      points: [{ x: 10, y: 20 }],
    };
    expect(strokeHitsPoint(textStroke, { x: 80, y: 30 }, 8)).toBe(true);
    expect(strokeHitsPoint(textStroke, { x: 400, y: 30 }, 8)).toBe(false);
  });

  it('adapts black/white ink cleanly across Light and Dark themes', () => {
    expect(resolveStrokeColor('#000000', true)).toBe('#f5f5f7');
    expect(resolveStrokeColor('#ffffff', false)).toBe('#111113');
    expect(resolveStrokeColor('#007aff', true)).toBe('#007aff');
  });
});
