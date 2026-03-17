import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { apiUrl } from '@/lib/api';

interface ShareOnXProps {
  duelSlug: string;
  justVoted?: boolean;
}

export function ShareOnX({ duelSlug, justVoted }: ShareOnXProps) {
  const [loading, setLoading] = useState(false);
  const [pulse, setPulse] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (justVoted) {
      timeoutRef.current = setTimeout(() => setPulse(true), 3000);
      return () => clearTimeout(timeoutRef.current);
    }
    setPulse(false);
  }, [justVoted]);

  async function handleShare() {
    setLoading(true);
    setPulse(false);
    try {
      const res = await fetch(apiUrl(`/api/duels/${encodeURIComponent(duelSlug)}/share-text`));
      const { text } = await res.json();

      // Cloudflare Worker proxies bot traffic to server share page for OG card
      const duelUrl = `https://cloakboard.com/d/${encodeURIComponent(duelSlug)}`;
      const intentUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(duelUrl)}`;

      window.open(intentUrl, '_blank', 'noopener,noreferrer');
    } catch {
      const duelUrl = `https://cloakboard.com/d/${encodeURIComponent(duelSlug)}`;
      const intentUrl = `https://x.com/intent/tweet?text=${encodeURIComponent('Check this out:')}&url=${encodeURIComponent(duelUrl)}`;
      window.open(intentUrl, '_blank', 'noopener,noreferrer');
    } finally {
      setLoading(false);
    }
  }

  return (
    <motion.button
      onClick={handleShare}
      disabled={loading}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.95 }}
      className={`share-border-btn relative flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-surface text-foreground ${pulse ? 'share-pulse' : ''}`}
    >
      {loading ? (
        <span className="w-4 h-4 border-2 border-foreground-muted/40 border-t-foreground rounded-full animate-spin" />
      ) : (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      )}
      <span className="hidden sm:inline">Share</span>

      <style>{`
        .share-border-btn {
          --border-angle: 0deg;
          border: 1px solid transparent;
          background-origin: border-box;
          background-clip: padding-box, border-box;
          background-image:
            linear-gradient(hsl(var(--card)), hsl(var(--card))),
            conic-gradient(from var(--border-angle), hsl(153 60% 56% / 0.3), hsl(190 55% 50% / 0.15), hsl(153 60% 56% / 0.3), hsl(210 45% 55% / 0.15), hsl(153 60% 56% / 0.3));
          animation: share-rotate 6s linear infinite;
        }
        .share-border-btn:hover {
          background-image:
            linear-gradient(hsl(var(--card)), hsl(var(--card))),
            conic-gradient(from var(--border-angle), hsl(153 60% 56% / 0.6), hsl(190 55% 50% / 0.3), hsl(153 60% 56% / 0.6), hsl(210 45% 55% / 0.3), hsl(153 60% 56% / 0.6));
        }
        .share-border-btn.share-pulse {
          background-image:
            linear-gradient(hsl(var(--card)), hsl(var(--card))),
            conic-gradient(from var(--border-angle), hsl(153 60% 56% / 0.8), hsl(190 55% 50% / 0.4), hsl(153 60% 56% / 0.8), hsl(210 45% 55% / 0.4), hsl(153 60% 56% / 0.8));
          animation-duration: 3s;
        }
        @keyframes share-rotate {
          to { --border-angle: 360deg; }
        }
        @property --border-angle {
          syntax: "<angle>";
          initial-value: 0deg;
          inherits: false;
        }
      `}</style>
    </motion.button>
  );
}
