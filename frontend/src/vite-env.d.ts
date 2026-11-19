/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional: call the API directly instead of through the /api rewrite. */
  readonly VITE_API_URL?: string;
  /** Google OAuth "Web application" client ID. Google sign-in is hidden when empty. */
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
