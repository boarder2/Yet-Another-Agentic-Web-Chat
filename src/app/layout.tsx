import type { Metadata } from 'next';
import { Montserrat } from 'next/font/google';
import './globals.css';
import { cn } from '@/lib/utils';
import Sidebar from '@/components/Sidebar';
import { Toaster } from 'sonner';
import ThemeController from '@/components/theme/Controller';
import { THEME_BOOT_SCRIPT } from '@/lib/theme/apply';
import SettingsModalProvider from '@/components/settings/SettingsModalProvider';
import EncryptionGate from '@/components/EncryptionGate';
import Providers from './providers';

const montserrat = Montserrat({
  weight: ['300', '400', '500', '700'],
  subsets: ['latin'],
  display: 'swap',
  fallback: ['Arial', 'sans-serif'],
});

export const metadata: Metadata = {
  title: 'YAAWC - Chat with the internet',
  description:
    'YAAWC is an AI powered chatbot that is connected to the internet.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html className="h-full" lang="en" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#1c1c1c" />
        <link
          rel="search"
          type="application/opensearchdescription+xml"
          title="YAAWC Search"
          href="/api/opensearch"
        />
        {/* Applies the stored theme before first paint, so there's no flash and
            the app doesn't have to withhold rendering until React hydrates. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className={cn('h-full bg-bg text-fg', montserrat.className)}>
        <Providers>
          <ThemeController>
            <EncryptionGate>
              <SettingsModalProvider>
                <Sidebar>{children}</Sidebar>
              </SettingsModalProvider>
            </EncryptionGate>
            <Toaster
              toastOptions={{
                unstyled: true,
                classNames: {
                  toast:
                    'bg-surface text-fg rounded-surface p-4 flex flex-row items-center space-x-2',
                },
              }}
            />
          </ThemeController>
        </Providers>
      </body>
    </html>
  );
}
