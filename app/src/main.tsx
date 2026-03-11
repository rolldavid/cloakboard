import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Providers } from './providers/Providers';
import App from './App';
import './globals.css';

// Initialize seed vault early (restores session key from sessionStorage or peer tabs).
import { initSeedVault } from '@/lib/wallet/seedVault';
initSeedVault();

// Eagerly start PXE + WASM prover initialization before auth.
// Helps Ethereum/Solana/Passkey (no page redirect) + returning users.
// For Google OAuth, the redirect kills this — GoogleCallback.tsx re-triggers.
import { startPxeWarmup, preloadArtifacts } from '@/lib/aztec/pxeWarmup';
startPxeWarmup();
preloadArtifacts();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Providers>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </Providers>
  </React.StrictMode>,
);
