import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
  plugins: [svelte()],
  define: {
    'import.meta.env.VITE_APP_COMMIT': JSON.stringify(appCommit),
    'import.meta.env.VITE_APP_COMMIT_DATE': JSON.stringify(appCommitDate),
  },
});
