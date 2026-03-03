import { CloakOwl } from './CloakOwl';

interface CloakLogoProps {
  showText?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const textSize = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-xl',
};

export function CloakLogo({ showText = true, size = 'md', className }: CloakLogoProps) {
  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <CloakOwl size={size} />
      {showText && (
        <span className={`font-semibold text-foreground ${textSize[size]}`}>
          Cloakboard
        </span>
      )}
    </div>
  );
}
