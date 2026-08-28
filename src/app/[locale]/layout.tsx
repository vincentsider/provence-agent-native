import type { Metadata } from 'next';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Archivo_Black, Zilla_Slab } from 'next/font/google';
import { locales } from '@/i18n/request';
import '../globals.css';

/**
 * Typography per the live-site probe: body/headings in Zilla Slab, uppercase
 * display in a heavy geometric sans. myprovence.fr uses MostraNuova-Heavy,
 * a commercial face we must not copy; Archivo Black is the closest open
 * face. next/font self-hosts both at build time, so font-src 'self' holds.
 */
const displayFont = Archivo_Black({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const slabFont = Zilla_Slab({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-slab',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Les guides de Provence, lisibles par les agents',
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
    <html lang={locale} className={`${displayFont.variable} ${slabFont.variable}`}>
      <head>
        {/* Start the catalogue download before the JS bundle finishes parsing
            (spec 7.4). The manifest is tiny and no-cache. */}
        <link rel="preload" href="/data/manifest.json" as="fetch" crossOrigin="anonymous" />
        {/* Machine discovery for fetch-only agents: the plain-HTTP ladder. */}
        <link rel="alternate" type="text/html" href="/agenda" title="Agenda (server-rendered)" />
        <link
          rel="alternate"
          type="application/json"
          href="/api/events"
          title="Events API (query, month, category, town)"
        />
        <link
          rel="alternate"
          type="application/json"
          href="/api/places"
          title="Places API (cluster, tags, query)"
        />
        <link rel="help" href="/llms.txt" title="Agent surface description" />
      </head>
      <body className="min-h-screen bg-white font-slab text-brand-ink antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
