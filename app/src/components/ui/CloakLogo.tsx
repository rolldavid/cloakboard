'use client';

import { cn } from '@/lib/utils';
import { CloakOwl } from './CloakOwl';

interface CloakLogoProps {
  showText?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function CloakLogo({ showText = true, size = 'md', className }: CloakLogoProps) {
  const textSize = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-xl',
  };

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <CloakOwl size={size} />
      {showText && (
        <span className={cn('font-semibold text-foreground', textSize[size])}>
          Cloakboard
        </span>
      )}
    </div>
  );
}
