import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from './state.svelte';
import { deriveV2Base, resolveSessionApi } from './api';

describe('API-Auswahl je Sitzung', () => {
  beforeEach(() => {
    app.apiBase = '/backend/api.php';
    app.apiMode = 'legacy';
    app.apiV2Base = '/api/v2';
    app.sessionId = '';
    app.sessionToken = 'a1b2';
    vi.restoreAllMocks();
  });

  it('leitet die v2-Basis aus alten Adapter-Links ab', () => {
    expect(new URL(deriveV2Base('/backend/api.php')).pathname).toBe('/api/v2');
  });

  it('schaltet eine Protokoll-2-Sitzung auf API v2', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      session_id: '5ec57fb2-0c67-4a3e-ab7c-93b5d53e5473',
      session_token: 'a1b2',
      bridge: { protocol_version: 2 },
    }), { status: 200 })));

    await resolveSessionApi();

    expect(app.apiMode).toBe('v2');
    expect(app.sessionId).toBe('5ec57fb2-0c67-4a3e-ab7c-93b5d53e5473');
  });

  it('lässt Protokoll 1 auf der Legacy-API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      session_id: null,
      session_token: 'a1b2',
      bridge: { protocol_version: 1 },
    }), { status: 200 })));

    await resolveSessionApi();

    expect(app.apiMode).toBe('legacy');
    expect(app.sessionId).toBe('');
  });
});
