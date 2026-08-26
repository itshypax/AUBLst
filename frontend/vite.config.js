import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mapsDirectory = resolve(repositoryRoot, 'backend', 'maps');

function routingEditorPlugin() {
  const imageTypes = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

  function validModId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,255}$/.test(value);
  }

  function isLoopbackRequest(request) {
    const address = String(request.socket.remoteAddress ?? '').toLowerCase();
    let hostname;
    try {
      hostname = new URL(`http://${request.headers.host ?? ''}`).hostname.toLowerCase();
    } catch {
      return false;
    }
    const loopbackAddress = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
    return loopbackAddress && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]');
  }

  function graphFile(modId) {
    return resolve(mapsDirectory, `${modId}.routing.json`);
  }

  function imageFile(modId) {
    for (const [extension, mime] of Object.entries(imageTypes)) {
      const file = resolve(mapsDirectory, `${modId}.${extension}`);
      if (existsSync(file)) return { file, mime };
    }
    return null;
  }

  function readRouting(modId) {
    const file = graphFile(modId);
    const defaults = modId.toUpperCase() === 'AUBMP'
      ? { map_width_px: 8192, map_height_px: 8192, pixels_per_meter: 10.5, grid_size_m: 50 }
      : { grid_size_m: 50 };
    if (!existsSync(file)) {
      return { coordinate_space: 'normalized', meters_per_world_unit: 0.1, ...defaults, nodes: [], edges: [] };
    }
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    return {
      coordinate_space: 'normalized',
      meters_per_world_unit: Number(saved.meters_per_world_unit) || 0.1,
      map_width_px: Number(saved.map_width_px) || defaults.map_width_px,
      map_height_px: Number(saved.map_height_px) || defaults.map_height_px,
      pixels_per_meter: Number(saved.pixels_per_meter) || defaults.pixels_per_meter,
      grid_size_m: Number(saved.grid_size_m) || defaults.grid_size_m,
      nodes: Array.isArray(saved.nodes) ? saved.nodes : [],
      edges: Array.isArray(saved.edges) ? saved.edges : [],
      bma_zones: Array.isArray(saved.bma_zones) ? saved.bma_zones : [],
    };
  }

  function sendJson(response, status, data) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(data));
  }

  function requestBody(request) {
    return new Promise((resolveBody, reject) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        body += chunk;
        if (body.length > 5_000_000) reject(new Error('Straßennetz ist zu groß'));
      });
      request.on('end', () => resolveBody(body));
      request.on('error', reject);
    });
  }

  return {
    name: 'routing-editor-files',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (url.pathname !== '/__routing-editor' && url.pathname !== '/__routing-editor-map') return next();
        if (!isLoopbackRequest(request)) return sendJson(response, 403, { error: 'Der Routing-Editor ist nur lokal verfügbar.' });
        const modId = url.searchParams.get('mod_id');
        if (!validModId(modId)) return sendJson(response, 400, { error: 'Ungültige oder fehlende mod_id' });

        if (url.pathname === '/__routing-editor-map') {
          const image = imageFile(modId);
          if (!image) return sendJson(response, 404, { error: `Kein Kartenbild für ${modId} gefunden` });
          response.writeHead(200, { 'Content-Type': image.mime, 'Cache-Control': 'no-store' });
          response.end(readFileSync(image.file));
          return;
        }

        if (request.method === 'GET') {
          if (!imageFile(modId)) return sendJson(response, 404, { error: `Kein Kartenbild backend/maps/${modId}.* gefunden` });
          return sendJson(response, 200, {
            mod_id: modId,
            map_image_url: `/__routing-editor-map?mod_id=${encodeURIComponent(modId)}`,
            routing: readRouting(modId),
          });
        }

        if (request.method === 'PUT') {
          try {
            const data = JSON.parse(await requestBody(request));
            const routing = {
              coordinate_space: 'normalized',
              meters_per_world_unit: Number(data.meters_per_world_unit) || 0.1,
              map_width_px: Number(data.map_width_px) || undefined,
              map_height_px: Number(data.map_height_px) || undefined,
              pixels_per_meter: Number(data.pixels_per_meter) || undefined,
              grid_size_m: Number(data.grid_size_m) || 50,
              nodes: Array.isArray(data.nodes) ? data.nodes : [],
              edges: Array.isArray(data.edges) ? data.edges : [],
              bma_zones: Array.isArray(data.bma_zones) ? data.bma_zones : [],
            };
            writeFileSync(graphFile(modId), `${JSON.stringify(routing, null, 2)}\n`, 'utf8');
            return sendJson(response, 200, routing);
          } catch (error) {
            return sendJson(response, 400, { error: error instanceof Error ? error.message : 'Speichern fehlgeschlagen' });
          }
        }

        return sendJson(response, 405, { error: 'Methode nicht erlaubt' });
      });
    },
  };
}

function gitValue(args) {
  try {
    return execFileSync(
      'git',
      ['-c', `safe.directory=${repositoryRoot.replaceAll('\\', '/')}`, '-C', repositoryRoot, ...args],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
  } catch {
    return '';
  }
}

const appCommit = process.env.VITE_APP_COMMIT?.trim() || gitValue(['rev-parse', '--short=8', 'HEAD']) || 'dev';
const appCommitDate = process.env.VITE_APP_COMMIT_DATE?.trim() || gitValue(['log', '-1', '--format=%cI']);

export default defineConfig({
  base: './',
  plugins: [routingEditorPlugin(), svelte()],
  define: {
    'import.meta.env.VITE_APP_COMMIT': JSON.stringify(appCommit),
    'import.meta.env.VITE_APP_COMMIT_DATE': JSON.stringify(appCommitDate),
  },
});
