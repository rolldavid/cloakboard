import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '@/store';

const CREATE_DUEL_THRESHOLD = Number(import.meta.env.VITE_CREATE_DUEL_THRESHOLD ?? 10);

/**
 * Hook to check if the user has enough points (level 2 = 50 points) to create duels.
 * Uses reactive whisperPoints from store for instant check, falls back to wallet-based proof.
 */
export function usePointsGate() {
  const { isAuthenticated, userAddress, whisperPoints } = useAppStore();
  const [canCreate, setCanCreate] = useState(false);
  const [checking, setChecking] = useState(true);
  const [points, setPoints] = useState(0);

  useEffect(() => {
    if (!isAuthenticated || !userAddress) {
      setCanCreate(false);
      setChecking(false);
      return;
    }

    setPoints(whisperPoints);
    setCanCreate(whisperPoints >= CREATE_DUEL_THRESHOLD);
    setChecking(false);
  }, [isAuthenticated, userAddress, whisperPoints]);

  const prove = useCallback(async (): Promise<boolean> => {
    if (!isAuthenticated || !userAddress) return false;
    if (CREATE_DUEL_THRESHOLD === 0) return true;
    return whisperPoints >= CREATE_DUEL_THRESHOLD;
  }, [isAuthenticated, userAddress, whisperPoints]);

  return { canCreate, checking, points, threshold: CREATE_DUEL_THRESHOLD, prove };
}
