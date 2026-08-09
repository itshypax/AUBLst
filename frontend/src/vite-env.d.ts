/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_COMMIT?: string;
  readonly VITE_APP_COMMIT_DATE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
