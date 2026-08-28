import { setRequestLocale } from 'next-intl/server';
import { ProbePage } from './ProbePage';

/**
 * /fr/outil-test — the day-1 empirical protocol page (v2 plan §1.2).
 * Unlisted; measures the driving agent's real behavior: tool-call timeout
 * ceiling, pending-ticket recall, mid-session registration visibility.
 * Results go to Docs/V1.5/webmcp/v2/EMPIRICAL_RESULTS.md.
 */
export default function Page({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  return <ProbePage />;
}
