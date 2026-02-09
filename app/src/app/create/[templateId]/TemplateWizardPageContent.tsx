'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getTemplateMetadata, resolveTemplateId } from '@/lib/constants/templates';
import { PrivacyBadge } from '@/components/privacy';
import type { TemplateId } from '@/lib/templates/TemplateFactory';
import { ConnectButton } from '@/components/wallet/ConnectButton';
import { CloakLogo } from '@/components/ui/CloakLogo';
import { TemplateIcon } from '@/components/ui/TemplateIcon';
import { useDeployCloak } from '@/lib/hooks/useDeployCloak';
import { nameToSlug } from '@/lib/utils/slug';
import { DeploymentExperience } from '@/components/deploy/DeploymentExperience';
import { GovernorBravoWizard } from '@/components/templates/wizards/GovernorBravoWizard';
import { OrganizationWizard } from '@/components/templates/wizards/OrganizationWizard';
import { TreasuryWizard } from '@/components/templates/wizards/TreasuryWizard';
import { GrantsWizard } from '@/components/templates/wizards/GrantsWizard';
import { WorkplaceWizard } from '@/components/templates/wizards/WorkplaceWizard';

interface TemplateWizardPageContentProps {
  templateId: string;
}

export function TemplateWizardPageContent({ templateId }: TemplateWizardPageContentProps) {
  const router = useRouter();
  const resolved = resolveTemplateId(templateId);
  const id = resolved ?? NaN;
  const { deploy, isDeploying, error: deployError, deployedAddress, isClientReady, isWalletConnected } = useDeployCloak();
  const [wizardConfig, setWizardConfig] = React.useState<any>(null);

  // Validate template ID
  const validIds = [1, 2, 3, 4, 5, 6];
  if (isNaN(id) || !validIds.includes(id)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">Invalid Template</h1>
          <p className="text-foreground-secondary mb-4">The template ID is not valid.</p>
          <Link
            href="/create"
            className="text-accent hover:text-accent font-medium"
          >
            &larr; Back to Template Selection
          </Link>
        </div>
      </div>
    );
  }

  const template = getTemplateMetadata(id as TemplateId);

  const handleSubmit = async (config: any) => {
    setWizardConfig(config);

    const address = await deploy(id, config);

    if (address) {
      // Clear wizard draft from localStorage
      const draftKeys: Record<number, string> = {
        1: 'governor-bravo-draft',
        2: 'organization-cloak-draft',
        4: 'treasury-cloak-draft',
        5: 'grants-cloak-draft',
        6: 'workplace-cloak-draft',
      };
      const draftKey = draftKeys[id];
      if (draftKey && typeof window !== 'undefined') {
        localStorage.removeItem(draftKey);
      }
      // DeploymentExperience handles the redirect after showing the success state
    }
  };

  const renderWizard = () => {
    switch (id) {
      case 1:
        return <GovernorBravoWizard onSubmit={handleSubmit} />;
      case 2:
        return <OrganizationWizard onSubmit={handleSubmit} />;
      case 3:
        // Gossip — placeholder, not yet implemented
        return <div className="text-center py-12 text-foreground-muted">Gossip template coming soon.</div>;
      case 4:
        return <TreasuryWizard onSubmit={handleSubmit} />;
      case 5:
        return <GrantsWizard onSubmit={handleSubmit} />;
      case 6:
        return <WorkplaceWizard onSubmit={handleSubmit} />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background-secondary">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/" className="flex items-center gap-2">
              <CloakLogo />
            </Link>
            <ConnectButton />
          </div>
        </div>
      </header>

      {/* Template Info Bar */}
      <div className="bg-card border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <Link
            href="/create"
            className="text-accent hover:text-accent text-sm mb-2 inline-block"
          >
            &larr; Change Template
          </Link>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg flex items-center justify-center bg-accent-muted">
              <TemplateIcon name={template.icon} size="lg" className="text-accent" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-foreground">{template.name}</h1>
                <PrivacyBadge level={template.defaultPrivacy} size="sm" />
              </div>
              <p className="text-sm text-foreground-muted">{template.description}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="py-8 px-4">
        <div className="max-w-3xl mx-auto">
          {/* Connection status banner */}
          {!isWalletConnected && (
            <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md text-sm text-yellow-800">
              No wallet connected. The Cloak will be saved locally only. Connect your wallet to deploy on-chain.
            </div>
          )}
          {/* Connection status shown only during deploy */}

          {/* Deploy error */}
          {deployError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-800">
              {deployError}
            </div>
          )}

          {/* Deploying overlay */}
          {isDeploying && (
            <DeploymentExperience
              templateId={id}
              config={wizardConfig}
              deployedAddress={deployedAddress}
              error={deployError}
            />
          )}

          {!isDeploying && renderWizard()}
        </div>
      </main>
    </div>
  );
}
