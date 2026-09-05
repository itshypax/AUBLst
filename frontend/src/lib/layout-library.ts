// Server-Bibliothek für Arbeitsansichten. Ein Layout auf dem Server hat einen
// sechsstelligen Code; lokal bekommt es eine feste ID aus diesem Code, damit
// erneutes Laden dieselbe Ansicht ersetzt statt eine zweite anzulegen.
import { api, apiGet } from './api';
import { normalizeWorkspace, type WorkspaceLayout } from './workspaces';

interface LayoutSummary {
  code: string;
  name: string;
  mod_id: string | null;
  updated_at: string;
}

interface LayoutResponse extends LayoutSummary {
  layout: { panels?: unknown } | null;
}

export function serverLayoutId(code: string): string {
  return `server-${code.toLowerCase()}`;
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export async function fetchLayout(rawCode: string): Promise<WorkspaceLayout> {
  const code = normalizeCode(rawCode);
  const data = await apiGet<LayoutResponse>('layouts_get', { code });
  const layout = normalizeWorkspace(
    { ...(data.layout ?? {}), id: serverLayoutId(code), name: data.name, code } as Partial<WorkspaceLayout>,
    serverLayoutId(code),
  );
  if (!layout.panels.length) throw new Error('Das Layout vom Server enthält keine Fenster.');
  return layout;
}

// Mit Code wird das vorhandene Server-Layout überschrieben, ohne Code (oder
// mit asNew) entsteht ein neues mit frischem Code.
export async function saveLayoutToServer(workspace: WorkspaceLayout, asNew = false): Promise<WorkspaceLayout> {
  const payload: Record<string, unknown> = { name: workspace.name, layout: { panels: workspace.panels } };
  if (workspace.code && !asNew) payload.code = workspace.code;
  const data = await api<{ code?: string }>('layouts_put', payload);
  const code = normalizeCode(String(data.code ?? workspace.code ?? ''));
  if (!code) throw new Error('Der Server hat keinen Layout-Code geliefert.');
  return { ...workspace, code };
}

// Import per Link oder Code: der Server bekommt eine eigene Kopie mit neuem
// Code, das Original bleibt beim Ersteller.
export async function importLayoutFromServer(rawCode: string): Promise<WorkspaceLayout> {
  const original = await fetchLayout(rawCode);
  const copy = await saveLayoutToServer(original, true);
  return { ...copy, id: serverLayoutId(copy.code!) };
}

export async function deleteLayoutFromServer(rawCode: string): Promise<void> {
  await api('layouts_delete', { code: normalizeCode(rawCode) });
}

// Teil-Link ohne Sitzungsdaten: nur Pfad und Layout-Code.
export function layoutShareUrl(code: string): string {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('layout', normalizeCode(code));
  return url.toString();
}
