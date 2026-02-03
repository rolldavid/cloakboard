'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { pageTransition } from '@/lib/motion';
import { ConnectButton } from '@/components/wallet/ConnectButton';
import { useWalletStatus, useAuth } from '@/components/wallet/WalletProvider';
import { Dashboard } from '@/components/dashboard';
import { CloakLogo } from '@/components/ui/CloakLogo';
import { TemplateIcon } from '@/components/ui/TemplateIcon';
import { TEMPLATE_METADATA, TEMPLATE_DISPLAY_ORDER, CATEGORY_INFO } from '@/lib/constants/templates';


const templateColorMap: Record<string, { bg: string; text: string }> = {
  slate: { bg: 'bg-slate-500/10', text: 'text-slate-400' },
  indigo: { bg: 'bg-indigo-500/10', text: 'text-indigo-400' },
  violet: { bg: 'bg-violet-500/10', text: 'text-violet-400' },
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  purple: { bg: 'bg-purple-500/10', text: 'text-purple-400' },
  rose: { bg: 'bg-rose-500/10', text: 'text-rose-400' },
  cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-400' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-400' },
  blue: { bg: 'bg-blue-500/10', text: 'text-blue-400' },
  pink: { bg: 'bg-pink-500/10', text: 'text-pink-400' },
  orange: { bg: 'bg-orange-500/10', text: 'text-orange-400' },
  teal: { bg: 'bg-teal-500/10', text: 'text-teal-400' },
};

const slideUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4 }
};

export default function HomePage() {
  const router = useRouter();
  const { isConnected: walletConnected, hasWallet } = useWalletStatus();
  const { isAuthenticated } = useAuth();

  const isConnected = walletConnected || isAuthenticated;

  // If authenticated, show dashboard
  if (isConnected) {
    return (
      <motion.div
        className="min-h-screen bg-background-secondary"
        initial="initial"
        animate="animate"
        exit="exit"
        variants={pageTransition}
      >
        <header className="border-b border-border bg-card">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center gap-2">
                <CloakLogo />
              </div>
              <ConnectButton />
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
            <p className="text-foreground-secondary mt-1">
              Manage your private Cloaks and memberships
            </p>
          </div>
          <Dashboard />
        </main>
      </motion.div>
    );
  }

  // Not authenticated — show landing page
  return (
    <motion.div
      className="min-h-screen"
      initial="initial"
      animate="animate"
      exit="exit"
      variants={pageTransition}
    >
      <header className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
              <CloakLogo />
            </div>
            <ConnectButton />
          </div>
        </div>
      </header>

      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <motion.h1
            className="text-4xl sm:text-5xl font-bold text-foreground mb-6"
            variants={slideUp}
          >
            
            <span className="text-accent">Organize Privately.</span>
          </motion.h1>
          <motion.p
            className="text-xl text-foreground-secondary mb-8 max-w-2xl mx-auto"
            variants={slideUp}
            transition={{ delay: 0.1 }}
          >
            Build and govern Cloaks with privacy-preserving voting, membership management,
            and treasury control.
          </motion.p>
          <motion.div
            className="flex flex-col sm:flex-row gap-4 justify-center"
            variants={slideUp}
            transition={{ delay: 0.2 }}
          >
            <motion.button
              onClick={() => router.push('/onboarding')}
              className="px-8 py-3 bg-accent hover:bg-accent-hover text-white rounded-md font-medium transition-colors"
              whileTap={{ scale: 0.97 }}
              whileHover={{ scale: 1.02 }}
              transition={{ type: 'spring', stiffness: 400, damping: 17 }}
            >
              Get Started
            </motion.button>
            <a
              href="#features"
              className="px-8 py-3 border border-border-hover hover:bg-card-hover text-foreground-secondary rounded-md font-medium transition-colors"
            >
              Learn More
            </a>
          </motion.div>
        </div>
      </section>

      <section id="features" className="py-20 bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-center text-foreground mb-12">
            Why Cloakboard?
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <motion.div
              className="text-center"
              variants={slideUp}
              initial="initial"
              whileInView="animate"
              viewport={{ once: true }}
            >
              <div className="w-12 h-12 bg-accent-muted rounded-md flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2 text-foreground">Private Voting</h3>
              <p className="text-foreground-secondary">
                Cast votes without revealing your identity. Only the final tally is public.
              </p>
            </motion.div>
            <motion.div
              className="text-center"
              variants={slideUp}
              initial="initial"
              whileInView="animate"
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
            >
              <div className="w-12 h-12 bg-accent-muted rounded-md flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2 text-foreground">Private Membership</h3>
              <p className="text-foreground-secondary">
                Member lists and voting power are hidden. Only members can prove their status.
              </p>
            </motion.div>
            <motion.div
              className="text-center"
              variants={slideUp}
              initial="initial"
              whileInView="animate"
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
            >
              <div className="w-12 h-12 bg-accent-muted rounded-md flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2 text-foreground">Zero-Knowledge Proofs</h3>
              <p className="text-foreground-secondary">
                Built on Aztec Network with cryptographic guarantees for privacy and security.
              </p>
            </motion.div>
          </div>
        </div>
      </section>

      <section className="py-20 px-4">
        <div className="max-w-7xl mx-auto sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-center text-foreground mb-4">
            Templates
          </h2>
          <p className="text-center text-foreground-secondary mb-12 max-w-2xl mx-auto">
            Choose a template to get started. Each one is purpose-built for a different kind of private organization.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {TEMPLATE_DISPLAY_ORDER.map((id) => {
              const template = TEMPLATE_METADATA[id];
              const isComingSoon = template.status === 'coming_soon';
              return (
                <motion.div
                  key={template.id}
                  className={`relative bg-zinc-900 border border-zinc-800 rounded-xl p-6 ${isComingSoon ? 'opacity-60' : 'hover:border-zinc-700 transition-colors'}`}
                  variants={slideUp}
                  initial="initial"
                  whileInView="animate"
                  viewport={{ once: true }}
                >
                  {isComingSoon && (
                    <span className="absolute top-4 right-4 text-xs font-medium bg-zinc-800 text-zinc-400 px-2 py-1 rounded-full">
                      Coming Soon
                    </span>
                  )}
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-4 ${templateColorMap[template.color]?.bg ?? ''}`}>
                    <TemplateIcon name={template.icon} size="lg" className={templateColorMap[template.color]?.text ?? ''} />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-1">{template.name}</h3>
                  <p className="text-sm text-foreground-secondary mb-3">{template.description}</p>
                  <span className="text-xs font-medium text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded">
                    {CATEGORY_INFO[template.category].label}
                  </span>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      <footer className="border-t border-border bg-card py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-foreground-muted">
          <p>Cloakboard</p>
        </div>
      </footer>
    </motion.div>
  );
}
