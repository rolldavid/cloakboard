import { useState, useEffect, useRef } from 'react';
import { SolanaKeyDerivation } from '@/lib/auth/solana/SolanaKeyDerivation';
import { SolanaAuthService } from '@/lib/auth/solana/SolanaAuthService';
import { useAuthCompletion } from '@/hooks/useAuthCompletion';

/**
 * Solana auth button — lazy-mounted by AuthMethodSelector.
 *
 * Uses window.phantom.solana directly instead of the wallet adapter.
 * Auto-connects on mount (mount is triggered by user click in AuthMethodSelector).
 * Falls back to manual click if auto-connect fails.
 */
export function SolanaAuthButton() {
  const { completeAuth } = useAuthCompletion();
  const [status, setStatus] = useState<'connecting' | 'signing' | 'error'>('connecting');
  const startedRef = useRef(false);

  const doConnect = async () => {
    const provider = (window as any).phantom?.solana;
    if (!provider?.isPhantom) {
      window.open('https://phantom.app/', '_blank');
      return;
    }

    setStatus('connecting');
    try {
      const resp = await provider.connect();
      const publicKey: string = resp.publicKey.toString();

      setStatus('signing');
      const message = new TextEncoder().encode(SolanaKeyDerivation.SIGN_MESSAGE);
      const { signature } = await provider.signMessage(message, 'utf8');
      const signatureHex = Array.from(new Uint8Array(signature))
        .map((b: number) => b.toString(16).padStart(2, '0'))
        .join('');

      const keys = SolanaKeyDerivation.deriveKeys(signatureHex);
      SolanaAuthService.storeSession(publicKey);

      await provider.disconnect();
      completeAuth(keys, 'solana', signatureHex);
    } catch (err: any) {
      console.error('[SolanaAuth] Failed:', err?.message);
      setStatus('error');
      try { (window as any).phantom?.solana?.disconnect(); } catch {}
    }
  };

  // Auto-connect on mount (component is lazy-mounted on user click)
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    doConnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const label =
    status === 'connecting' ? 'Opening Phantom...' :
    status === 'signing' ? 'Sign the message in Phantom' :
    'Failed — click to retry';

  const spinning = status === 'connecting' || status === 'signing';

  return (
    <button
      onClick={doConnect}
      disabled={spinning}
      className="block w-full p-4 rounded-lg border border-accent bg-accent-muted/30 text-left hover:bg-accent-muted/50 transition-colors disabled:opacity-70"
    >
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#9945FF]/20 to-[#14F195]/20 flex items-center justify-center">
          <svg className="w-6 h-6 text-[#14F195]" viewBox="0 0 397.7 311.7" fill="currentColor">
            <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" />
            <path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" />
            <path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" />
          </svg>
        </div>
        <div className="flex-1">
          <span className="font-semibold text-foreground">Phantom Wallet</span>
          <p className={`text-sm ${status === 'error' ? 'text-status-error' : 'text-foreground-secondary'}`}>{label}</p>
        </div>
        {spinning && (
          <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        )}
      </div>
    </button>
  );
}
