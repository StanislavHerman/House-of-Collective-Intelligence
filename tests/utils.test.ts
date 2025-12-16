import { getMimeType } from '../src/providers';

describe('getMimeType', () => {
  test('detects JPEG', () => {
    // '/9j/' is standard JPEG header base64
    expect(getMimeType('/9j/4AAQSkZJRg...')).toBe('image/jpeg');
  });

  test('detects PNG', () => {
    // 'iVBORw0KGgo' is standard PNG header base64
    expect(getMimeType('iVBORw0KGgoAAAANSUhEUg...')).toBe('image/png');
  });

  test('detects GIF (89a)', () => {
    // 'R0lGODlh' is GIF89a
    expect(getMimeType('R0lGODlhAQABA...')).toBe('image/gif');
  });

  test('detects WebP', () => {
    // 'UklGR' is RIFF...WEBP
    expect(getMimeType('UklGRiIAAABXRUJQVlA4...')).toBe('image/webp');
  });

  test('defaults to jpeg for unknown', () => {
    expect(getMimeType('unknownsignature...')).toBe('image/jpeg');
  });
});
