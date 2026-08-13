<script lang="ts">
  import type { FontAwesomeIconDefinition } from '../lib/fontawesome-icons';

  let {
    icon,
    size = 16,
    title = '',
    class: className = '',
    ...attributes
  }: {
    icon: FontAwesomeIconDefinition;
    size?: number | string;
    title?: string;
    class?: string;
    [key: string]: unknown;
  } = $props();

  const width = $derived(typeof size === 'number' ? `${size}px` : size);
  const paths = $derived(Array.isArray(icon[2]) ? icon[2] : [icon[2]]);
</script>

<svg
  {...attributes}
  class={className}
  style:width
  style:height={width}
  viewBox={`0 0 ${icon[0]} ${icon[1]}`}
  fill="currentColor"
  aria-hidden={title ? undefined : 'true'}
  role={title ? 'img' : undefined}
  focusable="false"
  xmlns="http://www.w3.org/2000/svg"
>
  {#if title}<title>{title}</title>{/if}
  {#each paths as path}<path d={path}></path>{/each}
</svg>

<style>
  svg { display: inline-block; flex: 0 0 auto; overflow: visible; vertical-align: -0.125em; }
</style>
