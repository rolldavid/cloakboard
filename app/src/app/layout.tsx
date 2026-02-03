import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import { ClientProviders } from '@/components/ClientProviders';
import { EthWalletProvider } from '@/components/wallet/EthWalletProvider';

const inter = Inter({ subsets: ['latin'] });

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://cloakboard.com';

export const metadata: Metadata = {
  title: 'Cloakboard',
  description: 'Create & manage private decentralized organizations',
  metadataBase: new URL(siteUrl),
  openGraph: {
    title: 'Cloakboard',
    description: 'Create & manage private decentralized organizations.',
    url: siteUrl,
    siteName: 'Cloakboard',
    images: [
      {
        url: '/cloak.webp',
        width: 2400,
        height: 1350,
        alt: 'Cloakboard - Private decentralized organizations',
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Cloakboard',
    description: 'Create & manage private decentralized organizations.',
    images: ['/cloak.webp'],
  },
  icons: {
    icon: '/favicon.ico',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} bg-background min-h-screen`}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <ClientProviders>
            <EthWalletProvider>
              {children}
            </EthWalletProvider>
          </ClientProviders>
        </ThemeProvider>
      </body>
    </html>
  );
}
