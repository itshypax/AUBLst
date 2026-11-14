import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminMods from './AdminMods.svelte';
import type { AdminMod } from '../../lib/admin';

const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as unknown as Response;
}

const mod: AdminMod = {
  mod_id: 'AUBMP',
  name: 'Auenburg',
  sessions: 3,
  updated_at: '2026-11-14 10:00:00',
  meters_per_world_unit: 0.1,
  map_source: 'file',
  map_file: 'AUBMP_2.webp',
  map_image_bytes: 0,
  map_mime_type: null,
  routing_source: 'file',
  routing_nodes: 412,
  routing_edges: 530,
  routing_bma_zones: 7,
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(jsonResponse(200, { mods: [mod] }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Mods in der Zentrale', () => {
  it('zeigt je Mod, woher Karte und Straßennetz kommen', async () => {
    render(AdminMods, { key: 'geheim' });

    await screen.findByText('Auenburg');
    const cells = [...document.querySelectorAll('tbody td')].map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim());
    expect(cells[0]).toBe('AUBMP');
    expect(cells[2]).toBe('Datei AUBMP_2.webp');
    expect(cells[3]).toBe('Datei 412 Knoten, 530 Kanten, 7 BMA-Zonen');
    expect(cells[4]).toBe('3');
  });

  it('speichert einen geänderten Namen ohne neues Bild', async () => {
    render(AdminMods, { key: 'geheim' });
    await screen.findByText('Auenburg');

    await fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Auenburg Nord' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await screen.findByText('AUBMP gespeichert.');
    const save = fetchMock.mock.calls.find((call) => String(call[0]).includes('mods_put'));
    expect(JSON.parse(save![1].body)).toEqual({ operator_key: 'geheim', mod_id: 'AUBMP', name: 'Auenburg Nord' });
  });

  it('lehnt eine Kennung mit Leerzeichen ab', async () => {
    render(AdminMods, { key: 'geheim' });
    await screen.findByText('Auenburg');

    await fireEvent.click(screen.getByRole('button', { name: 'Mod anlegen' }));
    await fireEvent.input(screen.getByLabelText('Kennung'), { target: { value: 'Neue Mod' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(screen.getByRole('alert').textContent).toContain('Mod-Kennung');
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('mods_put'))).toBe(false);
  });
});
