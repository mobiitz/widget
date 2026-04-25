/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BUNGEE_API_KEY?: string;
  readonly VITE_BUNGEE_API_BASE_URL?: string;
  readonly VITE_BUNGEE_AFFILIATE?: string;
  readonly VITE_BUNGEE_FEE_BPS?: string;
  readonly VITE_BUNGEE_FEE_TAKER_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
