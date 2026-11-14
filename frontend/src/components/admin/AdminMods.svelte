<script lang="ts">
  import {
    fetchMods,
    formatBytes,
    MOD_ASSET_SOURCE_LABELS,
    MOD_IMAGE_MIME_TYPES,
    readImageFile,
    routingEditorUrl,
    saveMod,
    type AdminMod,
  } from '../../lib/admin';

  const { key }: { key: string } = $props();

  // Der Routing-Editor arbeitet auf den Dateien in backend/maps und läuft nur
  // auf dem Entwicklungsrechner.
  const routingEditorAvailable =
    import.meta.env.DEV && ['localhost', '127.0.0.1', '::1'].includes(location.hostname);

  let mods = $state<AdminMod[] | null>(null);
  let error = $state('');
  let notice = $state('');
  let form = $state<{ modId: string; name: string; isNew: boolean } | null>(null);
  let image = $state<{ base64: string; mime: string; label: string } | null>(null);
  let saving = $state(false);

  $effect(() => {
    void load(key);
  });

  async function load(current: string): Promise<void> {
    try {
      mods = await fetchMods(current);
      error = '';
    } catch (cause) {
      error = (cause as Error).message;
    }
  }

  function edit(mod: AdminMod): void {
    form = { modId: mod.mod_id, name: mod.name ?? '', isNew: false };
    image = null;
    notice = '';
  }

  function create(): void {
    form = { modId: '', name: '', isNew: true };
    image = null;
    notice = '';
  }

  async function pickImage(event: Event): Promise<void> {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) {
      image = null;
      return;
    }
    try {
      const read = await readImageFile(file);
      image = { ...read, label: `${file.name}, ${formatBytes(file.size)}` };
      error = '';
    } catch (cause) {
      image = null;
      error = (cause as Error).message;
    }
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!form) return;
    const modId = form.modId.trim();
    if (!/^[A-Za-z0-9_.-]{1,255}$/.test(modId)) {
      error = 'Die Mod-Kennung darf nur Buchstaben, Ziffern, Punkt, Strich und Unterstrich enthalten.';
      return;
    }
    saving = true;
    try {
      await saveMod(key, { mod_id: modId, name: form.name.trim(), image });
      notice = `${modId} gespeichert.`;
      error = '';
      form = null;
      image = null;
      await load(key);
    } catch (cause) {
      error = (cause as Error).message;
    } finally {
      saving = false;
    }
  }
</script>

<div class="head">
  <p class="hint">
    Die Kennung legt das Spiel beim Verbinden selbst an. Name und Kartenbild kommen von hier, eine Datei in
    <code>backend/maps</code> hat aber Vorrang vor dem hochgeladenen Bild.
  </p>
  <button class="primary" onclick={create}>Mod anlegen</button>
</div>

{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if notice}<p class="hint">{notice}</p>{/if}

{#if form}
  <form class="sheet editor" onsubmit={submit}>
    <h2>{form.isNew ? 'Neue Mod' : `Mod ${form.modId}`}</h2>
    <label>
      <span>Kennung</span>
      <input bind:value={form.modId} readonly={!form.isNew} spellcheck="false" placeholder="AUBMP" />
    </label>
    <label>
      <span>Name</span>
      <input bind:value={form.name} placeholder="Auenburg" />
    </label>
    <label>
      <span>Kartenbild</span>
      <input type="file" accept={MOD_IMAGE_MIME_TYPES.join(',')} onchange={pickImage} />
    </label>
    <p class="hint">
      {#if image}Gewählt: {image.label}.{:else}Ohne Auswahl bleibt das gespeicherte Bild unverändert.{/if}
    </p>
    <div class="actions">
      <button type="submit" class="primary" disabled={saving}>Speichern</button>
      <button type="button" class="ghost" onclick={() => (form = null)}>Abbrechen</button>
    </div>
  </form>
{/if}

{#if mods}
  <section class="sheet">
    <table>
      <thead>
        <tr>
          <th>Kennung</th>
          <th>Name</th>
          <th>Karte</th>
          <th>Straßennetz</th>
          <th>Sitzungen</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each mods as mod (mod.mod_id)}
          <tr>
            <td><code>{mod.mod_id}</code></td>
            <td>{mod.name ?? '–'}</td>
            <td>
              <span class:missing={mod.map_source === 'none'}>{MOD_ASSET_SOURCE_LABELS[mod.map_source]}</span>
              <span class="hint">
                {#if mod.map_source === 'file'}{mod.map_file}{:else if mod.map_source === 'database'}{mod.map_mime_type}, {formatBytes(mod.map_image_bytes)}{/if}
              </span>
            </td>
            <td>
              <span class:missing={mod.routing_source === 'none'}>{MOD_ASSET_SOURCE_LABELS[mod.routing_source]}</span>
              {#if mod.routing_source !== 'none'}
                <span class="hint">{mod.routing_nodes} Knoten, {mod.routing_edges} Kanten, {mod.routing_bma_zones} BMA-Zonen</span>
              {/if}
            </td>
            <td class="number">{mod.sessions}</td>
            <td class="row-actions">
              <button class="ghost" onclick={() => edit(mod)}>Bearbeiten</button>
              {#if routingEditorAvailable}
                <a class="ghost" href={routingEditorUrl(mod.mod_id)} target="_blank" rel="noopener">Straßennetz</a>
              {/if}
            </td>
          </tr>
        {/each}
        {#if !mods.length}
          <tr><td colspan="6" class="hint">Noch keine Mod. Sobald sich ein Spiel verbindet, steht sie hier.</td></tr>
        {/if}
      </tbody>
    </table>
  </section>
{:else if !error}
  <p class="hint">Mods werden geladen.</p>
{/if}

<style>
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }
  .head .hint {
    max-width: 640px;
  }
  .sheet {
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel);
    overflow-x: auto;
  }
  .editor {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 12px;
  }
  .editor h2 {
    flex-basis: 100%;
    margin: 0;
    font-size: 13px;
    font-weight: 600;
  }
  .editor label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1 1 200px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .editor .hint {
    flex-basis: 100%;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  th,
  td {
    padding: 8px 10px;
    text-align: left;
    vertical-align: top;
    border-bottom: 1px solid var(--border);
  }
  th {
    font-weight: 600;
    color: var(--text-dim);
    white-space: nowrap;
  }
  td .hint {
    display: block;
    font-size: 11px;
  }
  .number {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .missing {
    color: var(--warn-text);
  }
  .row-actions {
    display: flex;
    gap: 6px;
    white-space: nowrap;
  }
  /* button.ghost aus app.css greift nicht auf dem Link daneben. */
  .row-actions a.ghost {
    padding: 3px 6px;
    color: var(--text-dim);
    text-decoration: none;
  }
  .row-actions a.ghost:hover {
    color: var(--text);
    background: var(--accent-soft);
    border-radius: var(--radius-sm);
  }
  .error {
    margin: 0;
    color: var(--danger-text);
    font-size: 13px;
  }
  .hint {
    margin: 0;
    color: var(--text-dim);
    font-size: 13px;
  }
</style>
