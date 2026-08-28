import { setRequestLocale } from 'next-intl/server';
import { App } from '@/components/App';
import { readUpcomingEvents } from '@/lib/build-data';

export default function Page({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  // Read at build so the served HTML carries real events: the one channel
  // every fetch-only assistant reliably receives is visible rendered text.
  const upcoming = readUpcomingEvents(12);
  return <App upcoming={upcoming} />;
}
