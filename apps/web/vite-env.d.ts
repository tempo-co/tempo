/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly VITE_BASE_PATH?: string;
  readonly VITE_API_URL: string;
  readonly VITE_APP_URL: string;
  readonly VITE_EMAIL_UI_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
