<script lang="ts">
  import { onMount } from 'svelte';

  const TOOLTIP_ID = 'app-tooltip';
  const EDGE_GAP = 8;
  const TARGET_GAP = 7;
  const HOVER_DELAY_MS = 250;

  let tooltip: HTMLDivElement | undefined = $state();
  let active: HTMLElement | null = null;
  let hovered: HTMLElement | null = null;
  let focused: HTMLElement | null = null;
  let described: HTMLElement | null = null;
  let previousDescription: string | null = null;
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  let keyboardFocusActive = false;
  let keyboardInteraction = true;

  let text = $state('');
  let visible = $state(false);
  let positioned = $state(false);
  let left = $state(0);
  let top = $state(0);

  function targetOf(value: EventTarget | null): HTMLElement | null {
    return value instanceof Element ? value.closest<HTMLElement>('[data-tooltip]') : null;
  }

  function restoreDescription(): void {
    if (!described) return;
    if (previousDescription === null) described.removeAttribute('aria-describedby');
    else described.setAttribute('aria-describedby', previousDescription);
    described = null;
    previousDescription = null;
  }

  function describe(target: HTMLElement): void {
    restoreDescription();
    described = target;
    previousDescription = target.getAttribute('aria-describedby');
    const ids = new Set((previousDescription ?? '').split(/\s+/).filter(Boolean));
    ids.add(TOOLTIP_ID);
    target.setAttribute('aria-describedby', [...ids].join(' '));
  }

  function place(): void {
    requestAnimationFrame(() => {
      if (!visible || !active || !tooltip) return;
      const targetRect = active.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const maxLeft = Math.max(EDGE_GAP, window.innerWidth - tooltipRect.width - EDGE_GAP);
      left = Math.min(maxLeft, Math.max(EDGE_GAP, targetRect.left + targetRect.width / 2 - tooltipRect.width / 2));

      const above = targetRect.top - tooltipRect.height - TARGET_GAP;
      const below = targetRect.bottom + TARGET_GAP;
      top = above >= EDGE_GAP ? above : Math.min(below, window.innerHeight - tooltipRect.height - EDGE_GAP);
      positioned = true;
    });
  }

  function hide(): void {
    if (showTimer) clearTimeout(showTimer);
    showTimer = undefined;
    visible = false;
    positioned = false;
    active = null;
    restoreDescription();
  }

  function open(target: HTMLElement, delayed: boolean): void {
    const value = target.dataset.tooltip?.trim();
    if (!value) {
      hide();
      return;
    }

    if (showTimer) clearTimeout(showTimer);
    restoreDescription();
    active = target;
    text = value;
    visible = false;
    positioned = false;

    const show = () => {
      showTimer = undefined;
      if (active !== target) return;
      visible = true;
      describe(target);
      place();
    };

    if (delayed) showTimer = setTimeout(show, HOVER_DELAY_MS);
    else show();
  }

  onMount(() => {
    const onPointerOver = (event: PointerEvent) => {
      const target = targetOf(event.target);
      if (!target || target === hovered) return;
      hovered = target;
      open(target, true);
    };
    const onPointerOut = (event: PointerEvent) => {
      const target = targetOf(event.target);
      if (!target || target !== hovered) return;
      if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return;
      hovered = null;
      if (focused && keyboardFocusActive) open(focused, false);
      else hide();
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = targetOf(event.target);
      if (!target) return;
      focused = target;
      keyboardFocusActive = keyboardInteraction;
      if (keyboardFocusActive) open(target, false);
    };
    const onFocusOut = (event: FocusEvent) => {
      const target = targetOf(event.target);
      if (!target || target !== focused) return;
      if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return;
      // Beim Schließen eines Dialogs wird focusout noch während dessen Abbau
      // ausgelöst. Die Tooltip-Reaktion läuft deshalb im nächsten Microtask.
      queueMicrotask(() => {
        if (focused !== target) return;
        focused = null;
        keyboardFocusActive = false;
        if (hovered) open(hovered, true);
        else hide();
      });
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      keyboardInteraction = false;
      keyboardFocusActive = false;
      hide();
    };
    const onScroll = () => {
      hovered = null;
      hide();
    };
    const onResize = () => place();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        hide();
        return;
      }
      keyboardInteraction = true;
    };

    window.addEventListener('pointerover', onPointerOver);
    window.addEventListener('pointerout', onPointerOut);
    window.addEventListener('focusin', onFocusIn);
    window.addEventListener('focusout', onFocusOut);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      if (showTimer) clearTimeout(showTimer);
      restoreDescription();
      window.removeEventListener('pointerover', onPointerOver);
      window.removeEventListener('pointerout', onPointerOut);
      window.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('focusout', onFocusOut);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
    };
  });
</script>

{#if visible}
  <div
    bind:this={tooltip}
    id={TOOLTIP_ID}
    class:positioned
    class="app-tooltip"
    role="tooltip"
    style={`left: ${left}px; top: ${top}px;`}
  >{text}</div>
{/if}

<style>
  .app-tooltip {
    position: fixed;
    z-index: 1000;
    max-width: min(320px, calc(100vw - 16px));
    padding: 5px 7px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: #24262a;
    color: var(--text);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.32);
    font-size: 12px;
    line-height: 1.35;
    overflow-wrap: anywhere;
    pointer-events: none;
    opacity: 0;
  }

  .app-tooltip.positioned {
    opacity: 1;
  }
</style>
