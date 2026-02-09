'use client';

import {
  Building2,
  Wallet,
  Users,
  TrendingUp,
  Gift,
  Scale,
  Image,
  Wrench,
  Drama,
  Microscope,
  Eye,
  Radio,
  Vote,
  KeyRound,
  BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  organization: Building2,
  treasury: Wallet,
  workplace: Users,
  investment: TrendingUp,
  grants: Gift,
  bravo: Scale,
  collector: Image,
  guild: Wrench,
  social: Drama,
  research: Microscope,
  glass: Eye,
  swarm: Radio,
  ballot: Vote,
  multi: KeyRound,
  tally: BarChart3,
};

interface TemplateIconProps {
  name: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const sizes = {
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-6 h-6',
};

export function TemplateIcon({ name, className, size = 'md' }: TemplateIconProps) {
  const Icon = iconMap[name] || Building2;
  return <Icon className={cn(sizes[size], className)} />;
}
