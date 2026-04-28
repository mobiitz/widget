/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ZEROX_API_BASE_URL?: string;
  readonly VITE_ZEROX_API_KEY?: string;
  readonly VITE_ZEROX_PROXY_URL?: string;
  readonly VITE_ZEROX_FEE_BPS?: string;
  readonly VITE_ZEROX_FEE_RECIPIENT?: string;
  readonly VITE_ZEROX_FEE_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
