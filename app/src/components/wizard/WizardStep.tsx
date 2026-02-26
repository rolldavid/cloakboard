import { ReactNode } from 'react';

interface WizardStepProps {
  title: string;
  description: string;
  children: ReactNode;
}

export function WizardStep({ title, description, children }: WizardStepProps) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground">{title}</h2>
        <p className="text-sm text-foreground-secondary mt-1">{description}</p>
      </div>
      {children}
    </div>
  );
}
