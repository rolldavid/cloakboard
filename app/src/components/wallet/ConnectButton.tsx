'use client';

/**
 * Connect Button Component
 *
 * - Not authenticated: "Login" button → navigates to /onboarding
 * - Authenticated: "Account" button with dropdown (Theme, Linked Accounts, Logout)
 */

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useTheme } from 'next-themes';
import { LinkedAccountsModal } from './LinkedAccountsModal';

interface ConnectButtonProps {
  className?: string;
  onConnect?: (address: string) => void;
}

export function ConnectButton({ className }: ConnectButtonProps) {
  const router = useRouter();
  const {
    isAuthenticated, username, method, logout, isLoading,
    linkedAccounts, linkGoogle, linkPasskey, linkPassword, linkEthereum, linkSolana, unlinkAccount,
    prepareGoogleLink,
  } = useAuth();
  const { theme, setTheme } = useTheme();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [linkedModalOpen, setLinkedModalOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [dropdownOpen]);

  const handleLogout = () => {
    setDropdownOpen(false);
    logout();
    router.push('/');
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const openLinkedAccounts = () => {
    setDropdownOpen(false);
    setLinkedModalOpen(true);
  };

  // Authenticated — show Account dropdown
  if (isAuthenticated) {
    return (
      <>
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-2 px-3 py-1.5 bg-background-secondary hover:bg-background-tertiary text-foreground rounded-md text-sm font-medium transition-colors"
          >
            <div className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
            <span>{username || 'Account'}</span>
            {method === 'ethereum' && (
              <span className="text-xs text-foreground-muted">ETH</span>
            )}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground-muted">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 mt-1 w-48 bg-card border border-border rounded-md shadow-lg z-50 py-1">
              <button
                onClick={toggleTheme}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground-secondary hover:bg-background-secondary transition-colors"
              >
                {theme === 'dark' ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="5" />
                    <line x1="12" y1="1" x2="12" y2="3" />
                    <line x1="12" y1="21" x2="12" y2="23" />
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                    <line x1="1" y1="12" x2="3" y2="12" />
                    <line x1="21" y1="12" x2="23" y2="12" />
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                  </svg>
                )}
                <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
              </button>

              <div className="border-t border-border my-1" />

              <button
                onClick={openLinkedAccounts}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground-secondary hover:bg-background-secondary transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                <span>Linked Accounts</span>
              </button>

              <div className="border-t border-border my-1" />

              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-status-error hover:bg-background-secondary transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                <span>Logout</span>
              </button>
            </div>
          )}
        </div>

        <LinkedAccountsModal
          isOpen={linkedModalOpen}
          onClose={() => setLinkedModalOpen(false)}
          primaryMethod={method}
          linkedAccounts={linkedAccounts}
          onLinkGoogle={linkGoogle}
          onLinkPasskey={linkPasskey}
          onLinkPassword={linkPassword}
          onLinkEthereum={linkEthereum}
          onLinkSolana={linkSolana}
          onUnlink={unlinkAccount}
          onPrepareGoogleLink={prepareGoogleLink}
        />
      </>
    );
  }

  // Not authenticated — show Login button
  return (
    <button
      onClick={() => router.push('/onboarding')}
      disabled={isLoading}
      className={`px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-md transition-colors disabled:opacity-50 ${className || ''}`}
    >
      {isLoading ? 'Loading...' : 'Login'}
    </button>
  );
}
