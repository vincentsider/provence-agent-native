import type { Metadata } from 'next';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { locales } from '@/i18n/request';
import '../globals.css';

export const metadata: Metadata = {
  title: 'Provence, lisible par les agents',
  description:
    'Les cinq guides de myprovence.fr, ouverts aux humains et aux agents IA sur la même page (WebMCP).',
  robots: { index: false, follow: false },
};

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const { locale } = params;
  if (!hasLocale(locales, locale)) notFound();
  setRequestLocale(locale);

  const messages = (await import(`@/messages/${locale}.json`)).default;

  return (
    <html lang={locale}>
      <head>
        {/* Start the catalogue download before the JS bundle finishes parsing
            (spec 7.4). The manifest is tiny and no-cache. */}
        <link rel="preload" href="/data/manifest.json" as="fetch" crossOrigin="anonymous" />
      </head>
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
