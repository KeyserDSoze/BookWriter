import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AppSettings, BookProject } from "@engine/domain/types";
import { serverBookConfigFromBook, type ServerConnection, type ServerInfo } from "@engine/domain/personal-server";
import { checklistEditorialProfiles } from "@engine/domain/editorial-profiles";
import { projectSettings, sameCloudSettings } from "@engine/domain/cloud-profile";
import {
  connectPersonalServer, createPersonalServerBook, disconnectPersonalServer, finishPairPersonalServer,
  pairPersonalServer, personalServerConfiguration, personalServerConnection, probePersonalServer,
  pendingPersonalServerCreation, provisionPersonalServer, resumePersonalServerCreation,
  setPersonalServerBookPat, syncPersonalServer, type PendingServerPairing, type ServerConfigurationReview,
} from "../../infrastructure/personal-server-client";
import { Button } from "../ui/button";
import { REPLICA_AUTO_UPDATE_PREF, replicaFeed, setReplicaAutoUpdate } from "../../application/personal-server-feed";
import { readPref } from "../../application/ui-prefs";
import {
  beginPersonalServerHandoff, cancelPersonalServerHandoff, checkPersonalServerHandoff, handoffBlocker,
  pendingPersonalServerHandoff, sendPersonalServerHandoff, type HandoffMarker,
} from "../../infrastructure/personal-server-handoff";

export function PersonalServerPanel({ settings, settingsDirty, book, onChanged, onCreated }: {
  settings: AppSettings; settingsDirty: boolean; book?: BookProject; onChanged: () => Promise<void>; onCreated: (id: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [shown, setShown] = useState(false);
  const [info, setInfo] = useState<ServerInfo>();
  const [connection, setConnection] = useState<ServerConnection>();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<PendingServerPairing>();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [keyActions, setKeyActions] = useState<Record<string, "delegate" | "revoke">>({});
  const [review, setReview] = useState<ServerConfigurationReview>();
  const [configurationError, setConfigurationError] = useState("");
  const [templateId, setTemplateId] = useState<string>();
  const [pendingCreation, setPendingCreation] = useState<Awaited<ReturnType<typeof pendingPersonalServerCreation>>>();
  const [writerChecklist, setWriterChecklist] = useState(true);
  const [writingStyle, setWritingStyle] = useState("Chiaro");
  const [audience, setAudience] = useState("Adulti");
  const serial = useRef(0);
  const feed = useSyncExternalStore(replicaFeed.subscribe, replicaFeed.getSnapshot);
  const [autoUpdate, setAutoUpdate] = useState(() => readPref(REPLICA_AUTO_UPDATE_PREF, true));
  const [handoff, setHandoff] = useState<HandoffMarker>();
  const bookId = book?.id;
  useEffect(() => {
    let mounted = true;
    if (!bookId) { setHandoff(undefined); return; }
    void pendingPersonalServerHandoff(bookId).then(value => { if (mounted) setHandoff(value); }).catch(() => { if (mounted) setHandoff(undefined); });
    return () => { mounted = false; };
  }, [bookId, book?.updatedAt, book?.executionAuthority?.epoch, connection?.id]);
  useEffect(() => {
    let mounted = true;
    void personalServerConnection().then(value => { if (mounted) { setConnection(value); if (value) setUrl(value.baseUrl); } });
    return () => { mounted = false; serial.current++; };
  }, []);
  useEffect(() => {
    let mounted = true;
    setReview(undefined); setConfigurationError(""); setKeyActions({}); setPendingCreation(undefined);
    if (!connection) return;
    void pendingPersonalServerCreation().then(value => { if (mounted) setPendingCreation(value); }).catch(() => undefined);
    void personalServerConfiguration().then(value => {
      if (mounted) setReview(value);
    }).catch(error => { if (mounted) setConfigurationError(error instanceof Error ? error.message : "Configurazione server non verificabile."); });
    return () => { mounted = false; };
  }, [connection?.id, connection?.baseUrl]);
  const execute = (action: () => Promise<void>) => {
    const ticket = serial.current; setBusy(true); setNotice("");
    void action().catch(error => { if (serial.current === ticket) setNotice(error instanceof Error ? error.message : "Operazione server non completata."); })
      .finally(() => { if (serial.current === ticket) setBusy(false); });
  };
  const refreshConfiguration = async () => {
    const ticket = serial.current;
    setConfigurationError(""); setReview(undefined);
    try { const next = await personalServerConfiguration(); if (serial.current === ticket) setReview(next); }
    catch (error) {
      if (serial.current === ticket) setConfigurationError(error instanceof Error ? error.message : "Configurazione server non verificabile.");
    }
  };
  const refreshConnection = async () => { setConnection(await personalServerConnection()); };
  const finishCreation = async (action: () => Promise<BookProject>) => {
    try {
      const created = await action();
      await onChanged(); onCreated(created.id); setTitle(""); setBrief(""); setTemplateId(undefined);
      setNotice("Libro creato e replica confermata, con le impostazioni scelte.");
    } finally { setPendingCreation(await pendingPersonalServerCreation().catch(() => undefined)); }
  };
  const afterHandoff = async (message: string) => {
    if (bookId) setHandoff(await pendingPersonalServerHandoff(bookId).catch(() => undefined));
    await onChanged(); setNotice(message);
  };
  const handoffBlock = book ? handoffBlocker(book) : undefined;
  const configurationReview = review?.connectionId === connection?.id ? review : undefined;
  const serverConfiguration = configurationReview?.configuration;
  const configMatches = serverConfiguration && !settingsDirty ? sameCloudSettings(projectSettings(settings), serverConfiguration.settings) : undefined;
  const delegatedKeys = new Set(serverConfiguration?.endpointKeys ?? []);
  const patBook = book && book.executionAuthority?.serverId === connection?.serverId && book.executionAuthority ? book : undefined;
  const patDelegated = !!patBook && !!serverConfiguration?.githubBooks.includes(patBook.id);
  const copyBookConfig = !!book && book.id === templateId;
  return <div className="space-y-5">
    <section className="panel min-w-0 space-y-3 p-4" aria-label="Connessione al server personale">
      <h2 className="text-lg font-semibold">Connessione</h2>
      <p className="muted text-sm">Sperimentale, non ancora una distribuzione completa. Nessun libro o segreto viene inviato dal solo collegamento.</p>
      <label className="block"><span>URL del server</span><input className="field" type="url" value={url}
        placeholder="https://server.example.org" onChange={event => { serial.current++; setBusy(false); setUrl(event.target.value); setInfo(undefined); setPending(undefined); setToken(""); }}/></label>
      <label className="block"><span>Token BookWriter (header apikey)</span><input className="field" type={shown ? "text" : "password"} value={token}
        autoComplete="off" onChange={event => { serial.current++; setBusy(false); setToken(event.target.value); }}/></label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => setShown(value => !value)}>{shown ? "Nascondi token" : "Mostra token"}</Button>
        <Button type="button" variant="outline" disabled={busy || !url} onClick={() => execute(async () => {
          const ticket = serial.current; const result = await probePersonalServer(url);
          if (serial.current === ticket) { setInfo(result); setNotice("Identità firmata ricevuta. Confronta l'impronta con il pannello locale prima di collegarti."); }
        })}>Verifica server</Button>
        <Button type="button" disabled={busy || !info || !token} onClick={() => execute(async () => {
          if (!info || !window.confirm("L'impronta coincide con il pannello locale? Il token verrà inviato solo a questo server e cifrato sul dispositivo.")) return;
          const ticket = serial.current;
          await connectPersonalServer(url, token, info, () => serial.current === ticket);
          if (serial.current === ticket) { setToken(""); await refreshConnection(); setNotice("Connessione verificata e token cifrato. Nessun motore avviato."); }
        })}>Collega server</Button>
        {connection && <Button type="button" variant="outline" disabled={busy} onClick={() => execute(async () => {
          serial.current++; await disconnectPersonalServer(); setConnection(undefined); setInfo(undefined); setToken(""); setBusy(false);
          setNotice("Server scollegato. I libri affidati restano repliche di sola lettura, senza fallback locale.");
        })}>Scollega questo dispositivo</Button>}
      </div>
      {info && <p className="break-all text-sm">Server {info.serverVersion} · motore {info.engineVersion} · API {info.apiVersion}<br/>Impronta: {info.fingerprint}</p>}
      {connection && <p className="break-all text-sm">Connessione salvata: {connection.baseUrl} · {connection.serverId}</p>}
      <details><summary>Abbina con un codice monouso</summary>
        <p className="muted my-2 text-sm">Generalo su 127.0.0.1:24105; dopo la richiesta approva il client nel pannello locale.</p>
        <label className="block">Codice di abbinamento<input className="field" value={code} maxLength={9}
          inputMode="numeric" autoComplete="off" onChange={event => setCode(event.target.value)}/></label>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" disabled={busy || !info || code.length !== 9} onClick={() => execute(async () => {
            if (!info || !window.confirm("L'impronta coincide con quella del pannello locale? Il codice verrà inviato a questo server.")) return;
            const ticket = serial.current; const request = await pairPersonalServer(url, code, "Browser BookWriter", info, () => serial.current === ticket);
            if (serial.current === ticket) { setPending(request); setCode(""); setNotice("Richiesta inviata: approvala nel pannello locale."); }
          })}>Richiedi abbinamento</Button>
          {pending && <Button type="button" disabled={busy} onClick={() => execute(async () => {
            const ticket = serial.current; const issued = await finishPairPersonalServer(pending, () => serial.current === ticket);
            if (serial.current !== ticket) return;
            if (issued) { setToken(issued); setPending(undefined); setNotice("Token ricevuto in memoria. Premi «Collega server» per salvarlo cifrato."); }
            else setNotice("Approvazione locale ancora in attesa.");
          })}>Controlla approvazione</Button>}
        </div>
      </details>
      {notice && <p className="break-words text-sm" role="status">{notice}</p>}
    </section>
    {connection && <section className="panel min-w-0 space-y-3 p-4">
      <h2 className="text-lg font-semibold">Libri e credenziali</h2>
      <label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" checked={autoUpdate} onChange={event => { setAutoUpdate(event.target.checked); setReplicaAutoUpdate(event.target.checked); }}/>
        <span>Aggiorna automaticamente le repliche su questo dispositivo</span>
      </label>
      <p className="muted text-sm" role="status" aria-live="polite">{feed.message}{feed.lastSyncAt ? ` Ultimo aggiornamento ${new Date(feed.lastSyncAt).toLocaleTimeString("it-IT")}.` : ""}</p>
      <p className="muted text-sm">L'aggiornamento automatico legge soltanto: non avvia AI, comandi o salvataggi. Il testo in arrivo dal modello non viene ancora mostrato per i libri del server; compaiono gli stati confermati. Ogni scheda aperta mantiene un proprio flusso.</p>
      <Button type="button" disabled={busy} onClick={() => execute(async () => {
        const count = await syncPersonalServer(); await onChanged(); setNotice(`${count} repliche confermate dal server. Nessuna chiamata AI avviata.`);
      })}>Sincronizza dal server</Button>
      <p className="muted text-sm">Questa prima tranche crea libri sul server e scarica repliche. Trasferimenti GitHub, ritorno al locale e tutte le funzioni editoriali remote non sono ancora completi. Non è attivo un inoltro globale di tutte le richieste.</p>
      {pendingCreation && <section className="space-y-2" aria-label="Creazione sul server da confermare">
        <p>Creazione di «{pendingCreation.input.title}» da confermare. Si può reinviare soltanto la stessa richiesta: non crea un duplicato e non avvia AI.</p>
        <Button type="button" variant="outline" disabled={busy} onClick={() => execute(() => finishCreation(resumePersonalServerCreation))}>Riprendi creazione sul server</Button>
      </section>}
      {!pendingCreation && <form className="space-y-2" onSubmit={event => { event.preventDefault(); execute(async () => {
        const bookConfig = copyBookConfig && book ? serverBookConfigFromBook(book)
          : writerChecklist ? { editorialProfiles: checklistEditorialProfiles(crypto.randomUUID()) } : undefined;
        if (!window.confirm("Creare questo nuovo libro sul server? Brief e le sole impostazioni scelte saranno conservati sulla macchina server; testo, memoria e consensi non vengono copiati da altri libri. Non avvia AI.")) return;
        await finishCreation(() => createPersonalServerBook({ title, brief, writingStyle, audience, bookConfig }));
      }); }}>
        <label className="block">Titolo del nuovo libro server<input className="field" required maxLength={300} value={title} onChange={e => setTitle(e.target.value)}/></label>
        <label className="block"><span>Idea del nuovo libro server</span><textarea className="field" required maxLength={100_000} rows={4} value={brief} onChange={e => setBrief(e.target.value)}/></label>
        <label className="block">Stile di scrittura<input className="field" maxLength={8000} value={writingStyle} onChange={e => setWritingStyle(e.target.value)}/></label>
        <label className="block">Pubblico<input className="field" maxLength={8000} value={audience} onChange={e => setAudience(e.target.value)}/></label>
        {book && <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={copyBookConfig}
          onChange={event => setTemplateId(event.target.checked ? book.id : undefined)}/><span>Usa le impostazioni editoriali, i modelli e il budget di «{book.title}». Non copia prosa, memoria, segreti, sinossi o consensi.</span></label>}
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" disabled={copyBookConfig} checked={writerChecklist}
          onChange={event => setWriterChecklist(event.target.checked)}/><span>Checklist dello scrittore in ogni revisione</span></label>
        <Button type="submit" disabled={busy || !connection.clientId}>Crea libro sul server</Button>
      </form>}
      {book && !handoff && <section className="space-y-2" aria-label="Affida il libro attivo al server">
        <h3 className="font-semibold">Affida il libro attivo al server</h3>
        <p className="muted text-sm">Trasferimento a senso unico di un libro locale fermo e senza GitHub. Il libro diventa subito una replica di sola lettura su questo dispositivo, prima dell'invio, così non possono esistere due autori attivi. I consensi del libro (ricerca web, condivisioni AI) vengono revocati e vanno riconsiderati. Copie e consensi locali di questo browser non si trasferiscono.</p>
        {handoffBlock && <p className="text-sm" role="note">{handoffBlock}</p>}
        <Button type="button" variant="outline" disabled={busy || !!handoffBlock || !connection.clientId} onClick={() => execute(async () => {
          if (!window.confirm(`Affidare «${book.title}» al server? Il libro locale diventa di sola lettura subito, anche se la rete si interrompe. Potrai riprendere l'invio o annullarlo solo se il server conferma di non averlo ricevuto. Non parte alcuna chiamata AI.`)) return;
          await beginPersonalServerHandoff(book.id, book.updatedAt);
          await afterHandoff("Libro bloccato localmente: invio al server in corso.");
          await sendPersonalServerHandoff(book.id);
          await afterHandoff("Libro accettato dal server e replica confermata. Nessuna chiamata AI avviata.");
        })}>Affida «{book.title}» al server</Button>
        {!connection.clientId && <p className="muted text-sm">Ricollega il server per abilitare i trasferimenti e i comandi: questa connessione è precedente al registro dei comandi.</p>}
      </section>}
      {book && handoff && <section className="space-y-2" aria-label="Trasferimento al server non concluso">
        <h3 className="font-semibold">Trasferimento al server non concluso</h3>
        <p className="muted text-sm">«{book.title}» è bloccato su questo dispositivo in attesa della conferma del server. Riprendere l'invio è sicuro: il server riconosce lo stesso trasferimento e non crea duplicati.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy} onClick={() => execute(async () => {
            await sendPersonalServerHandoff(book.id); await afterHandoff("Libro accettato dal server e replica confermata.");
          })}>Riprendi invio</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => execute(async () => {
            const result = await checkPersonalServerHandoff(book.id);
            await afterHandoff(result === "adopted" ? "Il server ha accettato il libro: replica confermata."
              : "Il server non ha ricevuto il libro. Questo non esclude un invio in ritardo: riprendi l'invio oppure annulla in modo definitivo.");
          })}>Verifica ricezione</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => execute(async () => {
            if (!window.confirm("Annullare il trasferimento? Il server registrerà un rifiuto durevole di questo invio e solo allora il libro tornerà modificabile qui. Se il server lo aveva già accettato, resterà sul server.")) return;
            const result = await cancelPersonalServerHandoff(book.id);
            await afterHandoff(result === "cancelled" ? "Trasferimento annullato dal server: il libro è di nuovo modificabile qui."
              : "Il server aveva già accettato il libro: replica confermata, nulla è stato annullato.");
          })}>Annulla trasferimento non ricevuto</Button>
        </div>
      </section>}
      <h3 className="font-semibold">Delega esplicita delle credenziali</h3>
      <p className="muted text-sm">Le basi AI devono essere prima approvate nel pannello locale. «localhost» indica il PC server. Le impostazioni non si sincronizzano da sole. Non vengono inviati token cloud o Cloudflare. Il vault server non è E2EE.</p>
      {settingsDirty && <p className="text-sm" role="alert">Salva prima le Impostazioni: il server riceve soltanto la configurazione persistita, non le modifiche ancora in bozza.</p>}
      {configurationError && <p className="text-sm" role="alert">Confronto con la configurazione server non riuscito: {configurationError}</p>}
      {serverConfiguration && <div className="rounded-lg border border-slate-300 p-3 text-sm dark:border-slate-700">
        <p role="status">Configurazione pubblica: {configMatches === undefined ? "confronto in attesa del salvataggio locale"
          : configMatches ? "coincide con le impostazioni salvate qui" : "diversa dalle impostazioni salvate qui"}.</p>
        <p className="muted">Chiavi AI presenti nel vault server: {serverConfiguration.endpointKeys.length || "nessuna"}.</p>
        {patBook && <p className="muted">PAT di «{patBook.title}»: {patDelegated ? "delegato" : "non delegato"}.</p>}
      </div>}
      {settings.endpoints.map(endpoint => <label key={endpoint.id} className="block">
        <span className="break-all">Chiave AI: {endpoint.name} · {endpoint.baseUrl}{delegatedKeys.has(endpoint.id) ? " · ID già configurato sul server" : ""}</span>
        <select className="field" value={keyActions[endpoint.id] ?? "keep"} disabled={busy || settingsDirty || !configurationReview}
          onChange={event => {
            const action = event.target.value;
            setKeyActions(previous => {
              const next = { ...previous };
              if (action === "delegate" || action === "revoke") next[endpoint.id] = action; else delete next[endpoint.id];
              return next;
            });
          }}>
          <option value="keep">Non inviare chiavi (mantieni se la base URL coincide)</option>
          <option value="delegate" disabled={!endpoint.secret || endpoint.authMode === "none"}>Delega o sostituisci con la chiave salvata qui</option>
          <option value="revoke" disabled={!delegatedKeys.has(endpoint.id)}>Rimuovi la chiave dal server</option>
        </select>
      </label>)}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={() => execute(refreshConfiguration)}>Rileggi configurazione server</Button>
        <Button type="button" variant="outline" disabled={busy || settingsDirty || !configurationReview} onClick={() => execute(async () => {
          if (!configurationReview || !window.confirm(`Sostituire le impostazioni AI globali del server (revisione ${configurationReview.configuration.revision}) con quelle salvate qui e applicare le azioni sulle chiavi? Le chiavi permettono richieste potenzialmente addebitate. Il PAT del libro non cambia.`)) return;
          await provisionPersonalServer(configurationReview, settings, keyActions); setKeyActions({}); await refreshConfiguration();
          setNotice("Configurazione e credenziali confermate dal server.");
        })}>{configMatches === false ? "Aggiorna configurazione sul server" : "Invia configurazione selezionata"}</Button>
        {patBook && <Button type="button" variant="outline" disabled={busy || settingsDirty || !configurationReview || !settings.githubToken} onClick={() => execute(async () => {
          if (!configurationReview || !window.confirm(`Delegare il PAT salvato a «${patBook.title}» per lease e salvataggi GitHub? Le impostazioni AI non cambiano.`)) return;
          await setPersonalServerBookPat(configurationReview, patBook.id, "delegate", settings.githubToken); await refreshConfiguration();
          setNotice("PAT delegato al server per il libro selezionato.");
        })}>Delega PAT al libro</Button>}
        {patBook && patDelegated && <Button type="button" variant="outline" disabled={busy || !configurationReview} onClick={() => execute(async () => {
          if (!configurationReview || !window.confirm(`Rimuovere il PAT delegato per «${patBook.title}» dal server? Le chiavi AI restano intatte, ma il server non potrà più fare lease o salvataggi GitHub per questo libro.`)) return;
          await setPersonalServerBookPat(configurationReview, patBook.id, "revoke"); await refreshConfiguration();
          setNotice("PAT revocato dal server per il libro selezionato.");
        })}>Revoca PAT delegato</Button>}
      </div>
    </section>}
    <section className="panel space-y-2 p-4">
      <h2 className="text-lg font-semibold">Installazione e aggiornamenti</h2>
      <p>Linux / Windows: pacchetti firmati non ancora disponibili. Nessun download o aggiornamento viene simulato.</p>
      <p className="muted text-sm">Avvio da sorgente: consulta <code>docs/personal-server-development.md</code>. Il pannello amministrativo usa 24105; il tunnel deve esporre solo l’API 24106. Non modificare tunnel di altre applicazioni.</p>
    </section>
  </div>;
}
