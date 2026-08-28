'use client';

/**
 * /fr/outil-test — the empirical probe bench (v2 plan section 1.2, issue #608).
 *
 * Unlisted page that registers THREE probe tools (separate from the catalogue
 * tools) so we can measure, on the real driving agent, the numbers the docs
 * do not publish for site tools:
 *
 *  P1 probe_sleep(seconds)      — the tool-call timeout ceiling. Ask the agent
 *                                 for 30, 50, 70, 90s; the first duration that
 *                                 errors or duplicates is the ceiling.
 *  P2 probe_ticket()            — returns a pending ticket + instruction to
 *                                 call probe_redeem later: does the agent
 *                                 recall a pending id across turns?
 *  P3 probe_redeem(ticket_id)   — redeems P2; the page logs the delay between
 *                                 issue and redeem.
 *
 * Results are shown on-page (visible text, so they land in Vincent's
 * screenshots) and go to Docs/V1.5/webmcp/v2/EMPIRICAL_RESULTS.md by hand.
 * The probes never touch the catalogue, telemetry or Supabase.
 */

import { useEffect, useSyncExternalStore } from 'react';

interface ProbeEntry {
  readonly id: number;
  readonly at: number;
  readonly line: string;
}

const MAX_LOG = 50;
let log: ProbeEntry[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const tickets = new Map<string, number>();
let probesRegistered = false;

let entrySeq = 0;
function push(line: string): void {
  log = [...log.slice(-(MAX_LOG - 1)), { id: ++entrySeq, at: Date.now(), line }];
  for (const fn of listeners) fn();
}
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const getLog = () => log;

function text(payload: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

/** Registered once per document, same guard idiom as webmcp/tools.ts. */
function registerProbes(): void {
  if (probesRegistered || typeof document === 'undefined') return;
  let mc;
  try {
    mc = document.modelContext;
  } catch {
    return;
  }
  if (!mc || typeof mc.registerTool !== 'function') return;
  probesRegistered = true;

  const defs = [
    {
      name: 'probe_sleep',
      title: 'Probe: attendre N secondes',
      description:
        'Diagnostic uniquement. Attend le nombre de secondes demandé puis répond. ' +
        'Sert à mesurer le plafond de temps par appel.',
      inputSchema: {
        type: 'object',
        properties: {
          seconds: { type: 'number', minimum: 1, maximum: 120 },
        },
        required: ['seconds'],
        additionalProperties: false,
      },
      execute: async (input: unknown, options?: { signal?: AbortSignal }) => {
        const seconds = Math.min(120, Math.max(1, Number((input as { seconds?: unknown })?.seconds) || 1));
        const started = Date.now();
        push(`probe_sleep(${seconds}s) démarré`);
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, seconds * 1000);
          options?.signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(t);
              push(`probe_sleep(${seconds}s) ANNULÉ par l'agent à ${((Date.now() - started) / 1000).toFixed(1)}s`);
              reject(options.signal?.reason ?? new Error('aborted'));
            },
            { once: true },
          );
        });
        push(`probe_sleep(${seconds}s) terminé (réel ${((Date.now() - started) / 1000).toFixed(1)}s)`);
        return text({ slept_seconds: seconds, elapsed_ms: Date.now() - started });
      },
    },
    {
      name: 'probe_ticket',
      title: 'Probe: ticket différé',
      description:
        'Diagnostic uniquement. Retourne immédiatement un ticket "pending". ' +
        'Rappelez probe_redeem avec ce ticket_id dans un tour SUIVANT de la conversation.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => {
        const id = `t-${++seq}`;
        // Bounded: an agent looping on probe_ticket must not grow memory.
        if (tickets.size >= 50) {
          const oldest = tickets.keys().next().value;
          if (oldest !== undefined) tickets.delete(oldest);
        }
        tickets.set(id, Date.now());
        push(`probe_ticket → ${id} émis`);
        return text({
          status: 'pending',
          ticket_id: id,
          instruction: `Plus tard dans la conversation, appelez probe_redeem avec ticket_id "${id}".`,
        });
      },
    },
    {
      name: 'probe_redeem',
      title: 'Probe: racheter un ticket',
      description: 'Diagnostic uniquement. Rachète un ticket émis par probe_ticket.',
      inputSchema: {
        type: 'object',
        properties: { ticket_id: { type: 'string', pattern: '^t-[0-9]{1,6}$' } },
        required: ['ticket_id'],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const id = String((input as { ticket_id?: unknown })?.ticket_id ?? '');
        const issued = tickets.get(id);
        if (issued === undefined) {
          push(`probe_redeem(${id}) → inconnu`);
          return text({ status: 'unknown_ticket', ticket_id: id });
        }
        tickets.delete(id);
        const delay = Math.round((Date.now() - issued) / 1000);
        push(`probe_redeem(${id}) → racheté après ${delay}s`);
        return text({ status: 'redeemed', ticket_id: id, recalled_after_seconds: delay });
      },
    },
  ];

  for (const def of defs) {
    try {
      void mc
        .registerTool({
          ...def,
          annotations: { readOnlyHint: true, untrustedContentHint: false },
        })
        .then(
          () => push(`${def.name} enregistré`),
          (err: unknown) => push(`${def.name} ÉCHEC: ${String(err).slice(0, 120)}`),
        );
    } catch (err) {
      push(`${def.name} ÉCHEC: ${String(err).slice(0, 120)}`);
    }
  }
}

const PROTOCOL: ReadonlyArray<string> = [
  'P1 — Demandez: "appelle probe_sleep avec seconds=30". Notez succès/échec.',
  'P2 — Répétez avec 50, puis 70, puis 90 secondes. La première durée qui échoue ou se dédouble donne le plafond.',
  'P3 — Demandez: "appelle probe_ticket". Puis parlez d\'autre chose pendant 2 à 3 tours.',
  'P4 — Demandez: "as-tu un ticket en attente ? si oui, rachète-le". Le journal ci-dessous dit si l\'agent a retenu l\'id.',
  'P5 — Capturez ce journal en capture d\'écran et reportez les chiffres dans EMPIRICAL_RESULTS.md.',
];

export function ProbePage() {
  useEffect(() => {
    registerProbes();
  }, []);
  const entries = useSyncExternalStore(subscribe, getLog, getLog);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 font-slab text-brand-ink">
      <p className="text-xs uppercase tracking-widest">page de diagnostic, non listée</p>
      <h1 className="display-caps mt-2 text-3xl">Banc d&apos;essai des outils</h1>
      <p className="mt-3 text-sm leading-relaxed">
        Trois outils de mesure sont enregistrés sur cette page (probe_sleep, probe_ticket,
        probe_redeem). Ils servent uniquement à mesurer le comportement réel de l&apos;agent
        qui pilote le navigateur. Aucune donnée n&apos;est envoyée nulle part.
      </p>

      <h2 className="mt-8 text-lg font-bold">Protocole (15 min)</h2>
      <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">
        {PROTOCOL.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      <h2 className="mt-8 text-lg font-bold">Journal</h2>
      <div
        data-testid="probe-log"
        className="mt-2 rounded border border-brand-ink/20 bg-brand-paper p-4 font-mono text-xs"
      >
        {entries.length === 0 ? (
          <p>En attente du premier appel…</p>
        ) : (
          entries.map((e) => (
            <p key={e.id}>
              {new Date(e.at).toLocaleTimeString('fr-FR')} — {e.line}
            </p>
          ))
        )}
      </div>
    </main>
  );
}
