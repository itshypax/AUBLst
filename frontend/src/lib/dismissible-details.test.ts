import { fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { dismissible, dismissibleDetails } from './dismissible-details';

function createDetails(): { details: HTMLDetailsElement; outside: HTMLButtonElement; destroy: () => void } {
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  const input = document.createElement('input');
  const outside = document.createElement('button');
  summary.textContent = 'Einstellungen';
  details.append(summary, input);
  document.body.append(details, outside);
  const action = dismissibleDetails(details);
  return { details, outside, destroy: action.destroy };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('Schließbare Details', () => {
  it('bleibt bei Interaktionen im Inhalt geöffnet', async () => {
    const { details, destroy } = createDetails();
    details.open = true;

    await fireEvent.pointerDown(details.querySelector('input')!);

    expect(details.open).toBe(true);
    destroy();
  });

  it('schließt bei einem Klick außerhalb', async () => {
    const { details, outside, destroy } = createDetails();
    details.open = true;

    await fireEvent.pointerDown(outside);

    expect(details.open).toBe(false);
    destroy();
  });

  it('bleibt bei einem Rechtsklick außerhalb unverändert', async () => {
    const { details, outside, destroy } = createDetails();
    details.open = true;

    await fireEvent.pointerDown(outside, { button: 2 });

    expect(details.open).toBe(true);
    destroy();
  });

  it('schließt bei einem Fokuswechsel nach außen', () => {
    const { details, outside, destroy } = createDetails();
    const input = details.querySelector('input')!;
    details.open = true;
    input.focus();

    outside.focus();

    expect(details.open).toBe(false);
    destroy();
  });

  it('schließt mit Escape und setzt den Fokus auf die Zusammenfassung', async () => {
    const { details, destroy } = createDetails();
    const summary = details.querySelector('summary')!;
    details.open = true;

    await fireEvent.keyDown(document, { key: 'Escape' });

    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
    destroy();
  });
});

describe('Schließbare Popover', () => {
  it('ignoriert den zugehörigen Schalter und schließt an anderen Stellen', async () => {
    const popover = document.createElement('div');
    const trigger = document.createElement('button');
    const outside = document.createElement('button');
    trigger.dataset.popoverTrigger = '';
    document.body.append(popover, trigger, outside);
    let dismissals = 0;
    const action = dismissible(popover, {
      onDismiss: () => dismissals += 1,
      ignore: (target) => target instanceof Element && Boolean(target.closest('[data-popover-trigger]')),
    });

    await fireEvent.pointerDown(trigger);
    expect(dismissals).toBe(0);

    await fireEvent.pointerDown(outside);
    expect(dismissals).toBe(1);
    action.destroy();
  });
});
