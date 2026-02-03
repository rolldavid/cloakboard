'use client';

import { useState, useEffect, useCallback } from 'react';
import { AztecClient, AztecConfig } from '../aztec/client';

const CONFIG: AztecConfig = {
  nodeUrl: process.env.NEXT_PUBLIC_AZTEC_NODE_URL || 'http://localhost:8080',
  environment: (process.env.NEXT_PUBLIC_AZTEC_ENV as AztecConfig['environment']) || 'local',
  sponsoredFpcAddress: process.env.NEXT_PUBLIC_SPONSORED_FPC_ADDRESS,
};

export function useAztec() {
  const [client, setClient] = useState<AztecClient | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initialize = useCallback(async () => {
    if (isInitializing || isInitialized) return;

    setIsInitializing(true);
    setError(null);

    try {
      const aztecClient = AztecClient.getInstance(CONFIG);
      await aztecClient.initialize();
      setClient(aztecClient);
      setIsInitialized(true);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to initialize Aztec';
      setError(errorMessage);
      console.error('Aztec initialization error:', err);
    } finally {
      setIsInitializing(false);
    }
  }, [isInitializing, isInitialized]);

  useEffect(() => {
    initialize();
  }, [initialize]);

  return {
    client,
    isInitialized,
    isInitializing,
    error,
    retry: initialize,
    config: CONFIG,
  };
}
