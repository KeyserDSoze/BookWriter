import { useEffect, useState } from "react";
import type { BookProject } from "@engine/domain/types";
import type { ServerCommand } from "@engine/domain/personal-server";
import { shortConflictPreview } from "@engine/domain/conflicts";
import type { MergeConflict } from "@engine/domain/book-merge";
import { listPersonalServerBranches, type PersonalServerBranches } from "../infrastructure/personal-server-client";
import { Button } from "./ui/button";

type Mode = "author" | "autopilot";
type Decision = "ours" | "theirs";

/** Branches, pull and merge of a server-owned book. Every action is a command the server runs in its own working copy. */
export function ServerGitPanel({ book, busy, act, command }: {
  book: BookProject; busy: boolean;
  act: (action: () => unknown | Promise<unknown>) => void; command: (value: ServerCommand) => void;
}) {
  const remote = book.remote;
  const session = book.mergeSession;
  const [branches, setBranches] = useState<PersonalServerBranches>();
  const [mode, setMode] = useState<Mode>("author");
  const [consent, setConsent] = useState(false);
  const [name, setName] = useState("");
  const [from, setFrom] = useState("");
  const [switchTo, setSwitchTo] = useState(true);
  const [target, setTarget] = useState("");
  const [choices, setChoices] = useState<Record<string, Decision>>({});
  useEffect(() => {
    setChoices(Object.fromEntries((session?.conflicts ?? []).filter(c => c.choice === "ours" || c.choice === "theirs").map(c => [c.id, c.choice as Decision])));
  }, [session?.id]);
  if (!remote) return null;
  const running = book.status === "running";
  const locked = busy || running || !remote.lastSyncedCommit;
  const others = (branches?.branches ?? []).filter(b => b.name !== remote.branch);
  const aiReady = mode !== "autopilot" || consent;
  const open = session?.conflicts.filter(c => c.choice === undefined) ?? [];
  const decided = (conflict: MergeConflict) => choices[conflict.id] ?? (conflict.choice === "proposal" ? undefined : conflict.choice);
  return <section className="space-y-3 border-t pt-3" aria-label="GitHub e branch sul server">
    <h3 className="font-semibold">GitHub e branch · cartella di lavoro del server</h3>
    <p className="muted break-all text-sm">Branch «{remote.branch}»{remote.lastSyncedCommit ? ` · commit ${remote.lastSyncedCommit.slice(0, 8)}` : " · primo salvataggio non ancora fatto"}.
      Il server aggiorna il repository prima di ogni avvio e di ogni salvataggio, unisce da solo ciò che non si sovrappone e si ferma sui conflitti.</p>
    {!session && <>
      <fieldset className="space-y-2">
        <legend className="font-medium">Aggiornamento</legend>
        <label className="block">Se ci sono conflitti
          <select className="field" value={mode} onChange={event => setMode(event.target.value as Mode)}>
            <option value="author">Decido io</option>
            <option value="autopilot">L'autopilot propone le scene modificate in entrambi</option>
          </select></label>
        {mode === "autopilot" && <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)}/>
          <span>Autorizzo l'invio al modello delle scene in conflitto e del canone, segreti compresi</span></label>}
        <Button type="button" disabled={locked || !aiReady} onClick={() => command({ type: "git_pull", mode, consentAi: consent })}>Aggiorna da GitHub (pull)</Button>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={() => act(async () => {
          const list = await listPersonalServerBranches(book.id); setBranches(list); setTarget(list.branches.find(b => b.name !== remote.branch)?.name ?? "");
        })}>Elenca i branch</Button>
      </div>
      {branches && <>
        <p className="muted text-sm">Branch: {branches.branches.map(b => b.name + (b.name === branches.current ? " (corrente)" : "")).join(", ") || "nessuno"}.
          {branches.dirty ? " Ci sono modifiche non ancora salvate su GitHub." : ""}</p>
        <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (target) command({ type: "git_switch_branch", branch: target }); }}>
          <label className="block">Passa al branch
            <select className="field" value={target} onChange={event => setTarget(event.target.value)}>
              {others.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}</select></label>
          <p className="muted text-sm">Serve il libro salvato su GitHub: il testo non viene mai sostituito senza averlo salvato.</p>
          <Button type="submit" variant="outline" disabled={locked || !target}>Passa al branch</Button>
        </form>
        <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (name.trim()) command({ type: "git_create_branch", name: name.trim(), ...(from ? { from } : {}), switchTo }); }}>
          <label className="block">Nome del nuovo branch<input className="field" value={name} onChange={event => setName(event.target.value)} maxLength={150} required/></label>
          <label className="block">Parti da
            <select className="field" value={from} onChange={event => setFrom(event.target.value)}>
              <option value="">Il branch corrente ({remote.branch})</option>
              {others.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}</select></label>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={switchTo} onChange={event => setSwitchTo(event.target.checked)}/><span>Lavora subito sul nuovo branch</span></label>
          <Button type="submit" variant="outline" disabled={locked || !name.trim()}>Crea il branch</Button>
        </form>
        <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (target && aiReady && window.confirm(`Unire «${target}» in «${remote.branch}»? Ciò che non si sovrappone viene preso da solo; i conflitti restano da decidere.`)) command({ type: "git_merge", from: target, mode, consentAi: consent }); }}>
          <label className="block">Unisci questo branch in «{remote.branch}»
            <select className="field" value={target} onChange={event => setTarget(event.target.value)}>
              {others.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}</select></label>
          <Button type="submit" variant="outline" disabled={locked || !target || !aiReady}>Unisci</Button>
        </form>
      </>}
    </>}
    {session && <div className="space-y-3" role="region" aria-label="Unione in corso">
      <p role="status">Unione di «{session.theirsBranch}» in «{session.oursBranch}» ({session.mode === "autopilot" ? "con l'autopilot" : "decidi tu"}): {open.length} conflitti senza decisione su {session.conflicts.length}.
        {session.stalled ? ` L'autopilot si è fermato: ${session.stalled}` : ""} Nulla è stato pubblicato.</p>
      {session.conflicts.map(conflict => <article key={conflict.id} className="min-w-0 space-y-2 border p-2">
        <h4 className="font-medium">{conflict.label}</h4>
        <div className="grid min-w-0 gap-2 md:grid-cols-2">
          <div className="min-w-0"><p className="font-medium">«{session.oursBranch}» (questo libro)</p>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-sm">{shortConflictPreview(previewOf(conflict.ours), 1200)}</pre></div>
          <div className="min-w-0"><p className="font-medium">«{session.theirsBranch}»</p>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-sm">{shortConflictPreview(previewOf(conflict.theirs), 1200)}</pre></div>
        </div>
        {conflict.choice === "proposal" && <div className="min-w-0"><p className="font-medium">Versione unita proposta</p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-sm">{shortConflictPreview(conflict.proposal, 1200)}</pre></div>}
        <fieldset className="flex flex-wrap gap-4" disabled={busy}>
          <legend className="sr-only">Decisione per {conflict.label}</legend>
          {(["ours", "theirs"] as const).map(value => <label key={value} className="flex min-h-11 items-center gap-2">
            <input type="radio" name={"scelta-" + conflict.id} checked={decided(conflict) === value} onChange={() => setChoices(previous => ({ ...previous, [conflict.id]: value }))}/>
            <span>{value === "ours" ? "Tieni «" + session.oursBranch + "»" : "Prendi «" + session.theirsBranch + "»"}</span></label>)}
        </fieldset>
      </article>)}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={busy || running || !Object.keys(choices).length}
          onClick={() => command({ type: "git_merge_resolve", mergeId: session.id, decisions: Object.fromEntries(Object.entries(choices).map(([id, choice]) => [id, { choice }])) })}>Salva le decisioni</Button>
        <Button type="button" disabled={busy || running || open.length > 0} onClick={() => command({ type: "git_merge_finish", mergeId: session.id })}>Concludi e pubblica l'unione</Button>
        <Button type="button" variant="outline" disabled={busy || running} onClick={() => { if (window.confirm("Annullare l'unione? Il libro resta com'era.")) command({ type: "git_merge_abort", mergeId: session.id }); }}>Annulla l'unione</Button>
      </div>
      <p className="muted text-sm">I capitoli toccati dall'unione vengono riaperti: dopo la pubblicazione, riprendi l'autopilot per la revisione editoriale.</p>
    </div>}
  </section>;
}

function previewOf(value: unknown): unknown {
  return value && typeof value === "object" && "text" in value && typeof (value as { text: unknown }).text === "string" ? (value as { text: string }).text : value;
}
