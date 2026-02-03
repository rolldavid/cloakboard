'use client';

/**
 * Domain Gate Modal
 *
 * Modal for verifying domain membership when joining domain-gated Cloaks.
 *
 * Flow:
 * 1. User clicks "Join" on domain-gated Cloak
 * 2. Modal shows required domain and verification options
 * 3. If user has cached proof, instant verification
 * 4. Otherwise, prompt Google sign-in to generate proof
 * 5. Submit proof to Cloak contract
 */

import React, { useState, useEffect } from 'react';
import { getDomainProofService } from '@/lib/auth/google/DomainProofService';
import { GoogleAuthService } from '@/lib/auth/google/GoogleAuthService';
import { GoogleAuthButton } from './GoogleAuthButton';
import type { DomainProof, ProofState } from '@/lib/auth/types';
import { LoadingOwl } from '@/components/ui/LoadingOwl';

interface DomainGateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onVerified: (proof: DomainProof) => void;
  requiredDomain: string;
  cloakName: string;
  accountAddress: string;
}

export function DomainGateModal({
  isOpen,
  onClose,
  onVerified,
  requiredDomain,
  cloakName,
  accountAddress,
}: DomainGateModalProps) {
  const [step, setStep] = useState<'check' | 'verify' | 'generating' | 'success' | 'error'>('check');
  const [proofState, setProofState] = useState<ProofState>({ status: 'idle' });
  const [error, setError] = useState<string | null>(null);

  // Check for existing proof on mount
  useEffect(() => {
    if (!isOpen) return;

    const checkExistingProof = async () => {
      const proofService = getDomainProofService();
      await proofService.initialize();

      const cachedProof = await proofService.getCachedProof(requiredDomain);

      if (cachedProof) {
        setStep('success');
        onVerified(cachedProof);
      } else {
        setStep('verify');
      }
    };

    checkExistingProof();
  }, [isOpen, requiredDomain, onVerified]);

  // Listen for proof generation updates
  useEffect(() => {
    const proofService = getDomainProofService();

    const unsubscribe = proofService.subscribe((state) => {
      setProofState(state);

      if (state.status === 'ready' && state.proof) {
        setStep('success');
        onVerified(state.proof);
      } else if (state.status === 'error') {
        setError(state.error || 'Failed to generate proof');
        setStep('error');
      }
    });

    return () => unsubscribe();
  }, [onVerified]);

  const handleGoogleAuth = () => {
    // Store state for OAuth callback
    sessionStorage.setItem('domain_gate_state', JSON.stringify({
      requiredDomain,
      cloakName,
      accountAddress,
    }));

    // Initiate Google OAuth
    GoogleAuthService.initiateOAuthFlow();
  };

  // Handle OAuth callback (when returning from Google)
  useEffect(() => {
    const callback = GoogleAuthService.parseOAuthCallback();

    const savedState = sessionStorage.getItem('domain_gate_state');
    if (callback?.idToken && savedState) {
      {
        const { requiredDomain: savedDomain, accountAddress: savedAddress } = JSON.parse(savedState);
        sessionStorage.removeItem('domain_gate_state');

        // Decode token to check domain
        try {
          const data = GoogleAuthService.decodeIdToken(callback.idToken);

          if (data.domain.toLowerCase() !== savedDomain.toLowerCase()) {
            setError(`Your email domain (${data.domain}) doesn't match the required domain (${savedDomain})`);
            setStep('error');
            return;
          }

          // Generate proof
          setStep('generating');
          const proofService = getDomainProofService();
          proofService.generateProofInBackground(callback.idToken, savedDomain, savedAddress);
        } catch (err) {
          setError('Failed to process Google sign-in');
          setStep('error');
        }

        sessionStorage.removeItem('domain_gate_state');
      }
    }
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-card rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-foreground-muted hover:text-foreground-secondary"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Checking for existing proof */}
        {step === 'check' && (
          <div className="text-center py-8">
            <LoadingOwl text="Checking verification status" />
          </div>
        )}

        {/* Verify with Google */}
        {step === 'verify' && (
          <>
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-accent-muted rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">Domain Verification Required</h2>
              <p className="text-foreground-secondary">
                <span className="font-medium">{cloakName}</span> requires members to have an email from:
              </p>
              <p className="text-accent font-medium text-lg mt-1">@{requiredDomain}</p>
            </div>

            <div className="bg-accent-muted rounded-md p-4 mb-6">
              <h4 className="font-medium text-accent mb-2">Privacy Protected</h4>
              <ul className="text-sm text-accent space-y-1">
                <li>• Your email is never revealed</li>
                <li>• Zero-knowledge proof verifies domain only</li>
                <li>• One-time verification, cached locally</li>
              </ul>
            </div>

            <GoogleAuthButton
              variant="primary"
              size="large"
              className="w-full mb-4"
            />

            <button
              onClick={onClose}
              className="w-full px-4 py-2 text-foreground-secondary hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </>
        )}

        {/* Generating proof */}
        {step === 'generating' && (
          <div className="text-center py-8">
            <LoadingOwl text="Generating zero-knowledge proof" />
            {proofState.progress !== undefined && (
              <div className="mt-4">
                <div className="w-full bg-background-tertiary rounded-full h-2">
                  <div
                    className="bg-accent h-2 rounded-full transition-all duration-300"
                    style={{ width: `${proofState.progress}%` }}
                  />
                </div>
                <p className="text-sm text-foreground-muted mt-2">{proofState.progress}%</p>
              </div>
            )}
          </div>
        )}

        {/* Success */}
        {step === 'success' && (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-status-success/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-status-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">Domain Verified!</h2>
            <p className="text-foreground-secondary">
              You have proven membership of @{requiredDomain}
            </p>
          </div>
        )}

        {/* Error */}
        {step === 'error' && (
          <>
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-status-error/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-status-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">Verification Failed</h2>
              <p className="text-foreground-secondary">{error}</p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-border text-foreground-secondary rounded-md hover:bg-card-hover transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => setStep('verify')}
                className="flex-1 px-4 py-2 bg-accent text-white rounded-md hover:bg-accent-hover transition-colors"
              >
                Try Again
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
