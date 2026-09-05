import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WORKSPACES } from './workspaces';

const mocks = vi.hoisted(() => ({ api: vi.fn(), apiGet: vi.fn() }));
vi.mock('./api', () => ({ api: mocks.api, apiGet: mocks.apiGet }));

import { deleteLayoutFromServer, fetchLayout, fetchLayoutList, layoutShareUrl, saveLayoutToServer, serverLayoutId } from './layout-library';

beforeEach(() => {
  mocks.api.mockReset();
  mocks.apiGet.mockReset();
  history.replaceState(null, '', '/?session_token=a1b2&workspace=standard');
});

describe('Layout-Bibliothek', () => {
  it('holt ein Layout vom Server und macht daraus eine lokale Ansicht mit Code', async () => {
    mocks.apiGet.mockResolvedValueOnce({
      code: 'K7F2MX',
      name: 'Wachraum',
      updated_at: '2026-09-05 10:00:00',
      layout: { panels: [{ key: 'map', type: 'map', x: 0, y: 0, w: 24, h: 16 }, { key: 'kaputt', type: 'kaputt', x: 0, y: 0, w: 3, h: 3 }] },
    });

    const layout = await fetchLayout('k7f2mx');

    expect(mocks.apiGet).toHaveBeenCalledWith('layouts_get', { code: 'K7F2MX' });
    expect(layout).toEqual({ id: serverLayoutId('K7F2MX'), name: 'Wachraum', code: 'K7F2MX', panels: [{ key: 'map', type: 'map', x: 0, y: 0, w: 24, h: 16 }] });
  });

  it('lehnt ein Server-Layout ohne brauchbare Fenster ab', async () => {
    mocks.apiGet.mockResolvedValueOnce({ code: 'K7F2MX', name: 'Leer', layout: { panels: [] } });

    await expect(fetchLayout('K7F2MX')).rejects.toThrow('keine Fenster');
  });

  it('überschreibt mit Code und legt auf Wunsch ein neues an', async () => {
    mocks.api.mockResolvedValue({ ok: true, code: 'NEU123', created: true });
    const workspace = { ...DEFAULT_WORKSPACES[0], code: 'K7F2MX' };

    await saveLayoutToServer(workspace);
    expect(mocks.api).toHaveBeenLastCalledWith('layouts_put', { code: 'K7F2MX', name: 'Standard', layout: { panels: workspace.panels } });

    const saved = await saveLayoutToServer(workspace, true);
    expect(mocks.api).toHaveBeenLastCalledWith('layouts_put', { name: 'Standard', layout: { panels: workspace.panels } });
    expect(saved.code).toBe('NEU123');
    expect(saved.id).toBe('standard');
  });

  it('listet, löscht und baut Teil-Links ohne Sitzungsdaten', async () => {
    mocks.apiGet.mockResolvedValueOnce({ layouts: [{ code: 'K7F2MX', name: 'Wachraum', mod_id: 'AUBMP', updated_at: '2026-09-05 10:00:00' }] });
    mocks.api.mockResolvedValueOnce({ ok: true });

    expect(await fetchLayoutList()).toEqual([{ code: 'K7F2MX', name: 'Wachraum', mod_id: 'AUBMP', updated_at: '2026-09-05 10:00:00' }]);
    await deleteLayoutFromServer('K7F2MX');
    expect(mocks.api).toHaveBeenCalledWith('layouts_delete', { code: 'K7F2MX' });
    const url = new URL(layoutShareUrl('K7F2MX'));
    expect(url.searchParams.get('layout')).toBe('K7F2MX');
    expect(url.searchParams.has('session_token')).toBe(false);
    expect(url.searchParams.has('workspace')).toBe(false);
  });
});
