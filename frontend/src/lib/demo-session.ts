interface DemoSession {
  session_token: string;
}

async function post<T>(apiBase: string, action: string, body: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${apiBase}?action=${encodeURIComponent(action)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null) as ({ error?: string } & T) | null;
    if (!response.ok) throw new Error(data?.error || `Serverfehler ${response.status}`);
    if (!data) throw new Error('Der Server hat keine gültige Antwort geliefert.');
    return data;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('Der Server antwortet nicht.', { cause: error });
    if (error instanceof TypeError) throw new Error('Der Server ist unter dieser Adresse nicht erreichbar.', { cause: error });
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function createDemoSession(apiBase: string): Promise<{ token: string; pin: string }> {
  const pin = String(1000 + Math.floor(Math.random() * 9000));
  const session = await post<DemoSession>(apiBase, 'session_create', {
    mod_id: 'demo-city',
    pin,
    map_bounds: { min_x: 0, min_y: -700, max_x: 1000, max_y: 0 },
  });
  const token = session.session_token;

  await post(apiBase, 'sync', {
    session_token: token,
    pin,
    mod_id: 'demo-city',
    map_bounds: { min_x: 0, min_y: -700, max_x: 1000, max_y: 0 },
    players: { 0: 'Leitstelle', 1: 'Gast' },
    vehicles: [
      { game_vehicle_id: '1_HLF_1', name: '1-HLF-1', type: '200', modes: 'Sondersignal,Still', x: 120, y: -340, status: 2 },
      { game_vehicle_id: '1_DLK_1', name: '1-DLK-1', type: '7', modes: 'Sondersignal,Still', x: 138, y: -350, status: 2 },
      { game_vehicle_id: '2_HLF_1', name: '2-HLF-1', type: '200', modes: 'Sondersignal,Still', x: 430, y: -210, status: 4 },
      { game_vehicle_id: '3_TLF_1', name: '3-TLF-1', type: '200', modes: 'Sondersignal,Still', x: 640, y: -380, status: 2 },
      { game_vehicle_id: '1_RTW_A', name: '1-RTW-A', type: '24', modes: 'Sondersignal,Still', x: 122, y: -338, status: 2 },
      { game_vehicle_id: '2_RTW_A', name: '2-RTW-A', type: '24', modes: 'Sondersignal,Still', x: 428, y: -212, status: 1 },
      { game_vehicle_id: '4_NEF_A', name: '4-NEF-A', type: '21', modes: 'Sondersignal,Still', x: 802, y: -522, status: 2 },
      { game_vehicle_id: '74_RTW_B', name: '74-RTW-B', type: '24', modes: 'Sondersignal,Still', x: 700, y: -300, status: 3 },
      { game_vehicle_id: 'Christoph_82', name: 'Christoph 82', x: 130, y: -350, status: 2 },
      { game_vehicle_id: 'FS_LST_1', name: 'AuenPort', modes: 'Schiffsverkehr sperren,Schiffsverkehr freigeben', x: -1000000, y: -1000000, status: 2 },
    ],
    hospitals: [
      { game_hospital_id: 'kh_1', name: 'Uni-Klinikum', x: 300, y: -300, icu_total: 6, icu_available: 1, ward_total: 20, ward_available: 7 },
      { game_hospital_id: 'kh_2', name: 'Hanse-Klinikum', x: 700, y: -600, icu_total: 4, icu_available: 2, ward_total: 12, ward_available: 4 },
    ],
    events: [
      { game_event_id: 'demo_1', name: 'Wohnungsbrand Hauptstraße 12', x: 420, y: -215, status: 'active' },
      { game_event_id: 'demo_2', name: 'Verkehrsunfall E-CALL', x: 650, y: -410, status: 'active' },
    ],
    messages: [
      { entity_id: '2_HLF_1', message: 'S4', long_message: 'Florian Auenburg 2-HLF-1: Ankunft an Einsatzstelle', state: 'active' },
      { entity_id: '74_RTW_B', message: 'Sprechwunsch', long_message: 'Rotkreuz Auenburg 74-RTW-B mit Sprechwunsch', state: 'active' },
      { entity_id: '', message: 'Lage', long_message: 'Tramverkehr eingestellt', state: 'active', type: 'global' },
    ],
    time: { h: 14, m: 35 },
  });

  return { token, pin };
}
