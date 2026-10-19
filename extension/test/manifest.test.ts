import { describe, expect, it } from 'vitest';
import { createManifest } from '../manifest.config';

describe('extension manifest', () => {
  it('grants only the exact local backend host permission', () => {
    const manifest = createManifest('http://127.0.0.1:8787');

    expect(manifest.permissions).toEqual(['activeTab', 'scripting']);
    expect(manifest.host_permissions).toEqual(['http://127.0.0.1:8787/*']);
  });

  it('rejects non-loopback and non-origin API URLs', () => {
    expect(() => createManifest('https://api.example.com')).toThrow('http://127.0.0.1');
    expect(() => createManifest('http://127.0.0.1:8787/path')).toThrow('without a path');
  });
});
