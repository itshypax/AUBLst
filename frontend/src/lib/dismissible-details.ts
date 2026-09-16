type DismissibleOptions = {
  onDismiss: () => void;
  ignore?: (target: Node) => boolean;
  restoreFocus?: () => void;
};

export function dismissible(node: HTMLElement, initialOptions: DismissibleOptions): { update: (options: DismissibleOptions) => void; destroy: () => void } {
  let options = initialOptions;

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    if (!(event.target instanceof Node) || node.contains(event.target) || options.ignore?.(event.target)) return;
    options.onDismiss();
  }

  function onFocusOut(event: FocusEvent): void {
    if (event.relatedTarget instanceof Node && (node.contains(event.relatedTarget) || options.ignore?.(event.relatedTarget))) return;
    // Verschwindet der fokussierte Knoten während eines Svelte-Updates, feuert
    // focusout mitten in dessen Renderlauf. Ein Zustandswechsel ist dort
    // verboten (state_unsafe_mutation), deshalb erst danach schließen.
    queueMicrotask(() => options.onDismiss());
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    options.onDismiss();
    options.restoreFocus?.();
  }

  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeydown);
  node.addEventListener('focusout', onFocusOut);

  return {
    update(nextOptions) {
      options = nextOptions;
    },
    destroy() {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeydown);
      node.removeEventListener('focusout', onFocusOut);
    },
  };
}

export function dismissibleDetails(node: HTMLDetailsElement): { destroy: () => void } {
  return dismissible(node, {
    onDismiss: () => {
      if (node.open) node.open = false;
    },
    ignore: () => !node.open,
    restoreFocus: () => node.querySelector<HTMLElement>(':scope > summary')?.focus(),
  });
}
