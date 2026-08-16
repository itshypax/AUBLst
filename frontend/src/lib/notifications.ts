import { app } from './state.svelte';
import type { EventItem, LogRow } from './types';

export function desktopNotificationsAvailable(): boolean {
  return typeof Notification !== 'undefined';
}

export async function setDesktopNotifications(enabled: boolean): Promise<string> {
  if (!enabled) {
    app.desktopNotifications = false;
    localStorage.setItem('desktopNotifications', 'false');
    return 'Desktop-Meldungen ausgeschaltet';
  }
  if (!desktopNotificationsAvailable()) return 'Dieser Browser unterstützt keine Desktop-Meldungen';
  const permission =
    Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  app.desktopNotifications = permission === 'granted';
  localStorage.setItem('desktopNotifications', String(app.desktopNotifications));
  return app.desktopNotifications ? 'Desktop-Meldungen eingeschaltet' : 'Benachrichtigungen wurden nicht freigegeben';
}

function show(title: string, body: string, tag: string): void {
  if (
    !app.desktopNotifications ||
    !document.hidden ||
    !desktopNotificationsAvailable() ||
    Notification.permission !== 'granted'
  )
    return;
  const notification = new Notification(title, { body, tag, icon: './aublst.png' });
  notification.onclick = () => {
    window.focus();
    notification.close();
  };
}

export function notifyNewIncidents(events: EventItem[]): void {
  if (!events.length) return;
  const body = events.length === 1 ? events[0].name || `Einsatz ${events[0].id}` : `${events.length} neue Einsätze`;
  show('Neuer Einsatz', body, events.length === 1 ? `incident-${events[0].id}` : 'new-incidents');
}

export function notifySpeechRequests(logs: LogRow[]): void {
  const requests = logs.filter((row) => {
    const text = `${row.message} ${row.long_message}`.toLocaleLowerCase('de-DE').replaceAll(' ', '');
    return (
      text.includes('sprechwunsch') ||
      ['5', 's5', 'status5', 'fms5'].includes(row.message.toLocaleLowerCase('de-DE').replaceAll(' ', ''))
    );
  });
  if (!requests.length) return;
  const body =
    requests.length === 1
      ? requests[0].long_message || requests[0].entity_id || 'Neuer Sprechwunsch'
      : `${requests.length} neue Sprechwünsche`;
  show('Sprechwunsch', body, 'speech-requests');
}
