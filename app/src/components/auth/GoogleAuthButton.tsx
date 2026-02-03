'use client';

/**
 * Google Auth Button Component
 *
 * Initiates Google OAuth flow for authentication.
 */

import React from 'react';
import { GoogleAuthService } from '@/lib/auth/google/GoogleAuthService';

interface GoogleAuthButtonProps {
  disabled?: boolean;
  variant?: 'primary' | 'outline';
  size?: 'default' | 'large';
  className?: string;
}

export function GoogleAuthButton({
  disabled = false,
  variant = 'outline',
  size = 'default',
  className = '',
}: GoogleAuthButtonProps) {
  const isConfigured = GoogleAuthService.isConfigured();

  const handleClick = () => {
    if (!isConfigured) {
      alert('Google OAuth is not configured. Set NEXT_PUBLIC_GOOGLE_CLIENT_ID in your environment variables.');
      return;
    }
    GoogleAuthService.initiateOAuthFlow();
  };

  const baseStyles = 'flex items-center justify-center gap-3 rounded-md transition-colors font-medium';
  const sizeStyles = size === 'large' ? 'px-6 py-4' : 'px-4 py-3';
  const variantStyles = variant === 'primary'
    ? 'bg-card hover:bg-card-hover text-foreground border border-border'
    : 'bg-card hover:bg-card-hover text-foreground-secondary border border-border';
  const disabledStyles = disabled || !isConfigured ? 'opacity-50 cursor-not-allowed' : '';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || !isConfigured}
      className={`${baseStyles} ${sizeStyles} ${variantStyles} ${disabledStyles} ${className}`.trim()}
    >
      {/* Google Logo SVG */}
      <svg className="w-5 h-5" viewBox="0 0 24 24">
        <path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        />
        <path
          fill="#FBBC05"
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        />
        <path
          fill="#EA4335"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        />
      </svg>
      <span>Continue with Google</span>
    </button>
  );
}
