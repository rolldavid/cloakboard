'use client';

import React, { useState, useEffect, useRef } from 'react';
import { nameToSlug } from '@/lib/utils/slug';
import { useAztecStore } from '@/store/aztecStore';

interface CloakNameInputProps {
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
}

/**
 * Shared cloak name input with debounced uniqueness checking.
 * Shows availability feedback as the user types or blurs.
 */
export function CloakNameInput({ value, onChange, placeholder = 'e.g., My Cloak' }: CloakNameInputProps) {
  const [nameStatus, setNameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkName = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameStatus('idle');
      return;
    }
    if (trimmed.length > 31) {
      setNameStatus('invalid');
      return;
    }
    const slug = nameToSlug(trimmed);
    if (!slug) {
      setNameStatus('invalid');
      return;
    }
    const taken = useAztecStore.getState().isSlugTaken(slug);
    setNameStatus(taken ? 'taken' : 'available');
  };

  // Debounced check as user types
  useEffect(() => {
    if (!value.trim()) {
      setNameStatus('idle');
      return;
    }
    setNameStatus('checking');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => checkName(value), 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  // Also check on blur for immediate feedback
  const handleBlur = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    checkName(value);
  };

  const slug = value.trim() ? nameToSlug(value) : '';

  return (
    <div>
      <label className="block text-sm font-medium text-foreground-secondary mb-1">
        Cloak Name *
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder}
        className="w-full px-4 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
        maxLength={31}
      />
      <div className="flex items-center gap-2 mt-1">
        <p className="text-xs text-foreground-muted">
          {value.length}/31 characters
          {slug && (
            <> &middot; URL: /cloak/<strong>{slug}</strong></>
          )}
        </p>
        {nameStatus === 'checking' && (
          <span className="text-xs text-foreground-muted">Checking...</span>
        )}
        {nameStatus === 'available' && (
          <span className="text-xs text-green-600">Available</span>
        )}
        {nameStatus === 'taken' && (
          <span className="text-xs text-red-500">Name already taken</span>
        )}
        {nameStatus === 'invalid' && value.trim() && (
          <span className="text-xs text-red-500">Invalid name</span>
        )}
      </div>
    </div>
  );
}
