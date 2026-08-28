'use client';

/**
 * The agent's questions, rendered as brand choice cards ON the page
 * (issue #608). Never a blocking modal: a slim strip pinned above the
 * content column. Tapping answers the pending tool call (or feeds
 * get_input_result if the call already degraded to a ticket); the close
 * cross declines — a decline is respected, never re-asked.
 */

import { useSyncExternalStore } from 'react';
import { getElicitationStore } from '@/lib/elicitation';
import { getSignalsLog } from '@/lib/signals';

export function ElicitationCards() {
  const store = getElicitationStore();
  const questions = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  if (questions.length === 0) return null;

  return (
    <div
      data-testid="elicitation-cards"
      className="fixed inset-x-0 bottom-4 z-[900] flex flex-col items-center gap-2 px-4"
      role="region"
      aria-label="Questions de l'agent"
    >
      {questions.map((q) => (
        <div
          key={q.id}
          className="w-full max-w-[560px] border-2 border-brand-ink bg-brand-yellow p-3 shadow-[4px_4px_0_#002731]"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="font-slab text-[15px] font-semibold leading-snug text-brand-ink">
              <span className="display-caps mr-2 bg-brand-petrol px-1.5 py-0.5 text-[9px] text-brand-yellow">
                l&apos;agent demande
              </span>
              {q.question}
            </p>
            <button
              type="button"
              aria-label="Fermer la question"
              className="display-caps shrink-0 px-1 text-[13px] text-brand-ink/60 hover:text-brand-red"
              onClick={() => store.decline(q.id)}
            >
              ✕
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {q.options.map((option) => (
              <button
                key={option}
                type="button"
                className="display-caps border-2 border-brand-ink bg-white px-3 py-1.5 text-[12px] text-brand-ink transition-colors hover:bg-brand-ink hover:text-brand-yellow"
                onClick={() => {
                  store.answer(q.id, option);
                  getSignalsLog().addAnswer(q.question, option);
                }}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
