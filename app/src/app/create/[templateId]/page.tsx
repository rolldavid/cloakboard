import { TemplateWizardPageContent } from './TemplateWizardPageContent';

interface PageProps {
  params: Promise<{ templateId: string }>;
}

export default async function TemplateWizardPage({ params }: PageProps) {
  const { templateId } = await params;
  return <TemplateWizardPageContent templateId={templateId} />;
}
