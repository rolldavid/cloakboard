/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AZTEC_NODE_URL: string;
  readonly VITE_SPONSORED_FPC_ADDRESS: string;
  readonly VITE_DEFAULT_NETWORK: string;
  readonly VITE_FAKE_PROOFS: string;
  readonly VITE_DUELCLOAK_ADDRESS?: string;
  readonly VITE_MULTI_AUTH_CLASS_ID?: string;
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
