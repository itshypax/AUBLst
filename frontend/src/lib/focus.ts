const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface FocusTrapOptions {
  initial?: string;
  inertSiblings?: boolean;
}

export function focusTrap(node: HTMLElement, options: FocusTrapOptions = {}) {
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const siblings = node.parentElement ? [...node.parentElement.children].filter((item) => item !== node) : [];
  const inertStates = siblings.map((item) => ({ item: item as HTMLElement, inert: (item as HTMLElement).inert }));
  if (options.inertSiblings !== false) {
    for (const { item } of inertStates) item.inert = true;
  }

  const visibleFocusable = (): HTMLElement[] =>
    [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.offsetParent !== null);

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const items = visibleFocusable();
    if (!items.length) {
      event.preventDefault();
      node.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  node.addEventListener('keydown', onKeydown);
  requestAnimationFrame(() => {
    const initial = options.initial ? node.querySelector<HTMLElement>(options.initial) : null;
    (initial ?? visibleFocusable()[0] ?? node).focus();
  });

  return {
    destroy() {
      node.removeEventListener('keydown', onKeydown);
      if (options.inertSiblings !== false) {
        for (const { item, inert } of inertStates) item.inert = inert;
      }
      if (previousFocus?.isConnected) previousFocus.focus();
    },
  };
}
