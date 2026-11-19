import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AppSettings, BookProject } from "@engine/domain/types";
import type { ServerConnection, ServerInfo } from "@engine/domain/personal-server";
import {
  connectPersonalServer, createPersonalServerBook, disconnectPersonalServer, finishPairPersonalServer,
  pairPersonalServer, personalServerConnection, probePersonalServer, provisionPersonalServer, syncPersonalServer,
} from "../../infrastructure/personal-server-client";
import { Button } from "../ui/button";
import { REPLICA_AUTO_UPDATE_PREF, replicaFeed, setReplicaAutoUpdate } from "../../application/personal-server-feed";
import { readPref } from "../../application/ui-prefs";
import {
  beginPersonalServerHandoff, cancelPersonalServerHandoff, checkPersonalServerHandoff, handoffBlocker,
  pendingPersonalServerHandoff, sendPersonalServerHandoff, type HandoffMarker,
} from "../../infrastructure/personal-server-handoff";

export function PersonalServerPanel({ settings, book, onChanged, onCreated }: {
  settings: AppSettings; book?: BookProject; onChanged: () => Promise<void>; onCreated: (id: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [shown, setShown] = useState(false);
  const [info, setInfo] = useState<ServerInfo>();
  const [connection, setConnection] = useState<ServerConnection>();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<{ id: string; nonce: string }>();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [pat, setPat] = useState(false);
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
  const execute = (action: () => Promise<void>) => {
    const ticket = serial.current; setBusy(true); setNotice("");
    void action().catch(error => { if (serial.current === ticket) setNotice(error instanceof Error ? error.message : "Operazione server non completata."); })
      .finally(() => { if (serial.current === ticket) setBusy(false); });
  };
  const refreshConnection = async () => { setConnection(await personalServerConnection()); };
  const afterHandoff = async (message: string) => {
    if (bookId) setHandoff(await pendingPersonalServerHandoff(bookId).catch(() => undefined));
    await onChanged(); setNotice(message);
  };
  const handoffBlock = book ? handoffBlocker(book) : undefined;
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
            const ticket = serial.current; const request = await pairPersonalServer(url, code, "Browser BookWriter");
            if (serial.current === ticket) { setPending(request); setCode(""); setNotice("Richiesta inviata: approvala nel pannello locale."); }
          })}>Richiedi abbinamento</Button>
          {pending && <Button type="button" disabled={busy} onClick={() => execute(async () => {
            const ticket = serial.current; const issued = await finishPairPersonalServer(url, pending);
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
      <form className="space-y-2" onSubmit={event => { event.preventDefault(); execute(async () => {
        if (!window.confirm("Creare questo nuovo libro sul server? Brief e impostazioni narrative saranno conservati sulla macchina server. Non avvia AI.")) return;
        const created = await createPersonalServerBook({ title, brief, writingStyle: "Chiaro", audience: "Adulti" });
        await onChanged(); onCreated(created.id); setTitle(""); setBrief(""); setNotice("Libro creato e replica confermata.");
      }); }}>
        <label className="block">Titolo del nuovo libro server<input className="field" required maxLength={300} value={title} onChange={e => setTitle(e.target.value)}/></label>
        <label className="block"><span>Idea del nuovo libro server</span><textarea className="field" required rows={4} value={brief} onChange={e => setBrief(e.target.value)}/></label>
        <Button type="submit" disabled={busy}>Crea libro sul server</Button>
      </form>
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
      <p className="muted text-sm">Le basi AI devono essere prima approvate nel pannello locale. «localhost» indica il PC server. Si trasferiscono le impostazioni AI salvate e solo le chiavi spuntate, mai token cloud o Cloudflare. Il vault server non è E2EE.</p>
      {settings.endpoints.map(endpoint => <label key={endpoint.id} className="flex min-h-11 items-center gap-2">
        <input type="checkbox" checked={selected.includes(endpoint.id)} onChange={e => setSelected(previous => e.target.checked ? [...previous, endpoint.id] : previous.filter(id => id !== endpoint.id))}/>
        <span className="break-all">Chiave AI: {endpoint.name} · {endpoint.baseUrl}</span></label>)}
      {book?.executionAuthority?.serverId === connection.serverId && <label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" checked={pat} onChange={e => setPat(e.target.checked)}/><span>Delega anche il PAT GitHub al server per «{book.title}»</span></label>}
      <Button type="button" variant="outline" disabled={busy} onClick={() => execute(async () => {
        if (!window.confirm("Inviare le impostazioni AI salvate e le sole credenziali selezionate al server verificato? Le chiavi permettono richieste potenzialmente addebitate; il PAT permette lease e salvataggi GitHub del libro selezionato.")) return;
        await provisionPersonalServer(selected, book?.id, pat); setSelected([]); setPat(false); setNotice("Configurazione e credenziali confermate dal server.");
      })}>Invia configurazione selezionata</Button>
    </section>}
    <section className="panel space-y-2 p-4">
      <h2 className="text-lg font-semibold">Installazione e aggiornamenti</h2>
      <p>Linux / Windows: pacchetti firmati non ancora disponibili. Nessun download o aggiornamento viene simulato.</p>
      <p className="muted text-sm">Avvio da sorgente: consulta <code>docs/personal-server-development.md</code>. Il pannello amministrativo usa 24105; il tunnel deve esporre solo l’API 24106. Non modificare tunnel di altre applicazioni.</p>
    </section>
  </div>;
}
