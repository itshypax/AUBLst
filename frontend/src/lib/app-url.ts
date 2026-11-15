// Der Alarmmonitor hat einen eigenen Pfad statt eines Parameters. Alte Links
// mit ?view=monitor oder ?monitor=1 gelten weiter und werden beim Start einmal
// auf den Pfad umgeschrieben. Die Leitstelle kann in einem Unterordner liegen,
// deshalb hängt jeder Pfad hier am aktuellen Ort und nicht an "/".

const MONITOR_SEGMENT = 'monitor';
const MONITOR_SUFFIX = /(?:^|\/)monitor\/?$/i;

function withoutDocument(pathname: string): string {
  return pathname.replace(/index\.html$/i, '');
}

export function isMonitorPath(pathname: string = location.pathname): boolean {
  return MONITOR_SUFFIX.test(withoutDocument(pathname));
}

// Pfad der Leitstelle, immer mit Schrägstrich am Ende.
export function controlRoomPath(pathname: string = location.pathname): string {
  const base = withoutDocument(pathname).replace(MONITOR_SUFFIX, '/');
  return base.endsWith('/') ? base : `${base}/`;
}

export function monitorPath(pathname: string = location.pathname): string {
  return `${controlRoomPath(pathname)}${MONITOR_SEGMENT}`;
}

function wantsMonitor(params: URLSearchParams): boolean {
  return params.get('view') === 'monitor' || params.get('monitor') === '1';
}

export function monitorRequested(
  search: string = location.search,
  pathname: string = location.pathname,
): boolean {
  return isMonitorPath(pathname) || wantsMonitor(new URLSearchParams(search));
}

// Schreibt einen alten Monitor-Link auf den Pfad um, ohne die Seite neu zu
// laden. Die übrigen Parameter (Wachen, Sitzung) bleiben stehen.
export function normalizeMonitorUrl(): void {
  if (typeof location === 'undefined' || typeof history === 'undefined') return;
  const params = new URLSearchParams(location.search);
  if (!wantsMonitor(params)) return;
  params.delete('view');
  params.delete('monitor');
  const query = params.toString();
  history.replaceState(null, '', `${monitorPath()}${query ? `?${query}` : ''}${location.hash}`);
}

// Link auf den Monitor, ausgehend von einer beliebigen Adresse der Leitstelle.
export function monitorUrl(from: URL): string {
  const url = new URL(from.toString());
  url.pathname = monitorPath(url.pathname);
  url.searchParams.delete('view');
  url.searchParams.delete('monitor');
  return url.toString();
}
