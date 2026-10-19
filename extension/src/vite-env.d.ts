/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_ORIGIN: string;
  readonly VITE_LOCAL_CLIENT_TOKEN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
