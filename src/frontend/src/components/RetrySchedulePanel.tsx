import { useEffect, useState } from "react";
import { getRetrySchedule, clearRetrySchedule } from "@engine/infrastructure/retry-schedule";
import type { RetrySchedule } from "@engine/core/retry-policy";
import { Button } from "./ui/button";
import type { BookProject } from "@engine/domain/types";
import { describeNextAutopilotStep } from "@engine/domain/autopilot-step";

export function RetrySchedulePanel({ book, onRetry, onChanged }: {
  book: BookProject; onRetry: (plan: RetrySchedule) => void; onChanged: () => Promise<void>;
}) {
  const bookId = book.id;
  const [plan, setPlan] = useState<RetrySchedule>();
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setPlan(undefined); setError("");
    const read = () => void getRetrySchedule(bookId).then(p => { if (current) setPlan(p); })
      .catch(() => { if (current) setError("Attesa di retry non verificabile: controlla il task prima di riprendere."); });
    read(); const timer = setInterval(read, 2000);
    return () => { current = false; clearInterval(timer); };
  }, [bookId]);
  if (!plan && !error) return null;
  return <section className="panel mb-4 space-y-2 p-3" aria-label="Retry long-term">
    {error && <p role="alert">{error}</p>}
    {plan && <>
      <p className="text-sm font-semibold">{plan.state === "waiting" ? describeNextAutopilotStep(book, { retry: plan }).headline : "Ripartenza long-term acquisita"}</p>
      <p className="muted text-sm">Ripartenza {plan.cyclesUsed + 1}{plan.policy.maxCycles === null ? " · senza limite" : ` di ${plan.policy.maxCycles}`} · non prima del {new Date(plan.nextRetryAt).toLocaleString("it-IT")}. Il budget della sessione resta invariato.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => void clearRetrySchedule(bookId, plan.generation)
          .then(() => { setPlan(undefined); return onChanged(); }).catch(() => setError("Impossibile annullare la ripartenza."))}>Annulla ripartenza</Button>
        {plan.state === "waiting" && <Button type="button" onClick={() => onRetry(plan)}>Riprova ora</Button>}
      </div>
    </>}
  </section>;
}
