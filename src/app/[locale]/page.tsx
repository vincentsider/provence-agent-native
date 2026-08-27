import { setRequestLocale } from 'next-intl/server';
import { App } from '@/components/App';

export default function Page({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  return <App />;
}
