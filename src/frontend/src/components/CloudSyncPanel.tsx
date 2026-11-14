import { useEffect, useState, useSyncExternalStore } from "react";
import { Cloud, KeyRound, LogOut, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "./ui/button";
import type { CloudController } from "../application/cloud-controller";
import { CLOUD_PROVIDER_LABEL, type CloudProvider } from "../infrastructure/cloud/types";
import { MIN_PASSPHRASE_LENGTH } from "../infrastructure/cloud/vault";

function Field({ label, value, onChange, type = "text", placeholder, autoComplete = "off" }: {
  label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string; autoComplete?: string;
}) {
  return <label className="block min-w-0">
    <span className="mb-1 block text-sm font-semibold">{label}</span>
    <input className="field" type={type} value={value} placeholder={placeholder} autoComplete={autoComplete}
      onChange={event => onChange(event.target.value)} />
  </label>;
}
const when = (iso?: string) => iso ? new Date(iso).toLocaleString("it-IT") : "—";

/** Sign-in and sync of the control plane (settings, credentials, book index). The
 * books themselves are never uploaded here: they live on GitHub. */
export function CloudSyncPanel({ controller, settingsDirty }: { controller: CloudController; settingsDirty: boolean }) {
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const { link, inspection, config, session } = snap;
  const profile = inspection?.profile;
  const [protection, setProtection] = useState<"passphrase" | "account">("passphrase");
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [remember, setRemember] = useState(true);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [draft, setDraft] = useState(config);
  // The saved configuration loads after the first render.
  useEffect(() => { setDraft(config); }, [config]);
  const [deviceName, setDeviceName] = useState("");
  const clean = () => { setPassphrase(""); setConfirmPassphrase(""); setConfirmReplace(false); };

  const configured = (provider: CloudProvider) =>
    provider === "google" ? !!config.googleClientId : !!config.microsoftClientId;
  const sessionValid = !!session && session.expiresAt > Date.now();
  const connected = snap.phase === "connected" && sessionValid;
  const newPassphraseOk = protection === "account" ||
    ([...passphrase.trim()].length >= MIN_PASSPHRASE_LENGTH && passphrase === confirmPassphrase);
  const blockedByDraft = settingsDirty;
  const remoteNewer = !!profile?.revision && !!link && profile.revision > link.profileRevision;
  const neverSynced = !!link && link.profileRevision === 0;

  const createProfile = () => void controller.pushProfile({
    protection, passphrase: protection === "passphrase" ? passphrase : undefined, remember, rotate: true,
    overwrite: confirmReplace,
  }).then(clean);
  const sendProfile = () => void controller.pushProfile({
    protection: link?.vaultMode ?? protection, passphrase: passphrase || undefined, remember,
  }).then(() => { if (!controller.getSnapshot().needsPassphrase) clean(); });
  const applyProfile = () => void controller.applyCloudProfile({ passphrase: passphrase || undefined, remember }).then(() => {
    if (!controller.getSnapshot().needsPassphrase) clean();
  });

  const protectionFields = <fieldset className="space-y-2 rounded-lg border border-slate-300 p-3 dark:border-slate-700">
    <legend className="px-1 text-sm font-semibold">Come proteggere PAT GitHub e chiavi API nel cloud</legend>
    <label className="flex items-start gap-2 text-sm">
      <input type="radio" name="cloud-protection" className="mt-1 size-4 accent-emerald-600" checked={protection === "passphrase"}
        onChange={() => setProtection("passphrase")} />
      <span><b>Con passphrase (consigliato)</b>: cifrate nel browser. Nemmeno Google o Microsoft possono leggerle. Su ogni nuovo PC digiti la passphrase una volta.</span>
    </label>
    <label className="flex items-start gap-2 text-sm">
      <input type="radio" name="cloud-protection" className="mt-1 size-4 accent-emerald-600" checked={protection === "account"}
        onChange={() => setProtection("account")} />
      <span><b>Solo con il login cloud (meno sicuro)</b>: nessuna passphrase. Chi entra nel tuo account può leggere PAT e chiavi: non è cifratura end-to-end.</span>
    </label>
    {protection === "passphrase" && <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Nuova passphrase del vault" type="password" value={passphrase} onChange={setPassphrase}
        placeholder={`Almeno ${MIN_PASSPHRASE_LENGTH} caratteri`} autoComplete="new-password" />
      <Field label="Ripeti la nuova passphrase" type="password" value={confirmPassphrase} onChange={setConfirmPassphrase} autoComplete="new-password" />
    </div>}
    {protection === "passphrase" && <>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1 size-4 accent-emerald-600" checked={remember} onChange={e => setRemember(e.target.checked)} />
        <span>Ricorda la passphrase su questo dispositivo (resta solo la chiave derivata, protetta come le altre chiavi del browser).</span>
      </label>
      <p className="muted text-xs">Se dimentichi la passphrase non esiste recupero: dovrai reinserire PAT e chiavi su ogni PC.</p>
    </>}
  </fieldset>;

  const unlockField = profile?.vaultMode === "passphrase" || snap.needsPassphrase
    ? <Field label="Passphrase del vault esistente (vuota se già ricordata su questo dispositivo)" type="password" value={passphrase}
      onChange={setPassphrase} autoComplete="current-password" /> : null;

  return <section className="panel min-w-0 space-y-4 p-4 sm:p-5" aria-label="Account cloud">
    <div>
      <h2 className="flex items-center gap-2 text-lg font-semibold"><Cloud size={20} /> Account cloud: impostazioni, chiavi e libreria su ogni PC</h2>
      <p className="muted mt-1 text-sm">
        Accedi con Google o Microsoft per ritrovare su ogni computer le impostazioni dei modelli AI, le chiavi, il PAT GitHub
        e l'elenco dei libri con il loro stato. <b>I libri veri e propri restano su GitHub.</b>
      </p>
    </div>

    <details className="rounded-lg border border-slate-300 p-3 text-sm dark:border-slate-700">
      <summary className="min-h-11 cursor-pointer font-semibold">Cosa viene salvato nel cloud, e cosa no</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li><b>Impostazioni AI</b>: endpoint, modelli, router per task, thinking e tariffe. Non il tema né il consenso all'ispezione delle richieste, che restano su ogni dispositivo.</li>
        <li><b>Credenziali</b>: PAT GitHub e chiavi API, nel vault (con passphrase o solo con il login cloud).</li>
        <li><b>Elenco dei libri</b>: titolo, stato, avanzamento e repository GitHub di ciascun libro.</li>
        <li><b>Mai</b>: testo, trama, memoria narrativa, segreti dei personaggi, log delle attività. Quelli vanno solo su GitHub.</li>
      </ul>
      <p className="muted mt-2 text-xs">Il cloud usa la cartella privata dell'app (Google Drive «appDataFolder» o OneDrive «Apps/…»): gli altri programmi e i tuoi altri file non sono toccati.</p>
    </details>

    {snap.error && <p role="alert" className="rounded-lg border border-red-500/50 p-3 text-sm text-red-700 dark:text-red-300">{snap.error}</p>}
    {snap.message && !snap.error && <p role="status" className="rounded-lg border border-emerald-500/40 p-3 text-sm">{snap.message}</p>}

    {!link && <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button disabled={!configured("google") || snap.busy} onClick={() => void controller.connect("google")}>Accedi con Google</Button>
        <Button disabled={!configured("microsoft") || snap.busy} onClick={() => void controller.connect("microsoft")}>Accedi con Microsoft</Button>
      </div>
      {(!configured("google") || !configured("microsoft")) && <p className="muted text-xs">
        {!configured("google") && !configured("microsoft") ? "Nessun accesso è ancora configurato su questo dispositivo." : !configured("google")
          ? "L'accesso Google non è configurato." : "L'accesso Microsoft non è configurato."}{" "}
        Crea le app registration seguendo la guida (docs/cloud-app-registration-ste100.md) e inserisci i valori qui sotto.
      </p>}
    </div>}

    {link && <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-300 p-3 text-sm dark:border-slate-700">
        <p><b>{CLOUD_PROVIDER_LABEL[link.provider]}</b> · {link.accountLabel}
          <span className="muted block text-xs">
            {connected ? "Connesso" : snap.phase === "connecting" ? "Accesso in corso…" : "Non connesso: la sessione è scaduta"}
            {connected && session && ` · valida fino alle ${new Date(session.expiresAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`}
          </span></p>
        <div className="flex flex-wrap gap-2">
          {!connected && <Button disabled={snap.busy || !configured(link.provider)} onClick={() => void controller.connect(link.provider)}>
            <RefreshCw size={16} /> Riconnetti</Button>}
          <Button variant="outline" disabled={snap.busy} onClick={() => void controller.disconnect()}>
            <LogOut size={16} /> Scollega questo dispositivo</Button>
          {link.provider === "google" && <Button variant="outline" disabled={snap.busy || !connected}
            onClick={() => void controller.disconnect(true)}>Scollega e revoca l'accesso di Google</Button>}
        </div>
      </div>
      <p className="muted text-xs">{link.provider === "google"
        ? "Google concede un accesso di circa un'ora per volta: poi premi Riconnetti (di solito basta un clic, senza password)."
        : "Microsoft rinnova l'accesso da solo per 24 ore: poi una nuova finestra di accesso (di solito senza password)."}</p>

      {connected && <>
        {blockedByDraft && <p role="status" className="rounded-lg border border-amber-500/50 p-3 text-sm">
          Hai modifiche non salvate nelle impostazioni dei modelli: premi «Salva impostazioni» o «Annulla» prima di sincronizzare con il cloud.</p>}

        <div className="space-y-3 rounded-lg border border-slate-300 p-3 dark:border-slate-700">
          <h3 className="flex items-center gap-2 font-semibold"><KeyRound size={17} /> Impostazioni e credenziali</h3>
          {!inspection && <p role="status" className="muted text-sm">Controllo del cloud in corso…</p>}
          {inspection && !profile?.exists && <>
            <p className="text-sm">Nel cloud non c'è ancora nessun profilo. Puoi caricare quello di questo dispositivo.</p>
            {protectionFields}
            <Button disabled={snap.busy || blockedByDraft || !newPassphraseOk} onClick={createProfile}>
              <ShieldCheck size={16} /> Carica impostazioni e chiavi sul cloud</Button>
          </>}

          {profile?.exists && profile.invalid && <>
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">Il profilo nel cloud non è leggibile: {profile.invalid}</p>
            {protectionFields}
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 size-4 accent-emerald-600"
              checked={confirmReplace} onChange={e => setConfirmReplace(e.target.checked)} />
              <span>Confermo: sostituisco il profilo cloud con quello di questo dispositivo.</span></label>
            <Button variant="destructive" disabled={snap.busy || blockedByDraft || !confirmReplace || !newPassphraseOk} onClick={createProfile}>
              Sostituisci il profilo cloud con questo dispositivo</Button>
          </>}

          {profile?.exists && !profile.invalid && neverSynced && <>
            <p className="text-sm">Nel cloud c'è già un profilo (revisione {profile.revision}, da «{profile.deviceName}», {when(profile.updatedAt)}).
              Scegli quale tenere: l'altro verrà sostituito.</p>
            <div className="space-y-2 rounded-lg border border-emerald-500/40 p-3">
              <p className="text-sm font-semibold">Usa il profilo del cloud su questo dispositivo</p>
              <p className="muted text-xs">Sostituisce endpoint, modelli, router e tariffe di questo PC; porta PAT e chiavi. Il tema e le chiavi che il cloud non ha restano.</p>
              {unlockField}
              {profile.vaultMode === "passphrase" && <label className="flex items-start gap-2 text-sm"><input type="checkbox"
                className="mt-1 size-4 accent-emerald-600" checked={remember} onChange={e => setRemember(e.target.checked)} />
                <span>Ricorda la passphrase su questo dispositivo.</span></label>}
              <Button disabled={snap.busy || blockedByDraft} onClick={applyProfile}>Usa il profilo cloud su questo dispositivo</Button>
            </div>
            <div className="space-y-2 rounded-lg border border-amber-500/40 p-3">
              <p className="text-sm font-semibold">Oppure sostituisci il profilo del cloud con quello di questo PC</p>
              {protectionFields}
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 size-4 accent-emerald-600"
                checked={confirmReplace} onChange={e => setConfirmReplace(e.target.checked)} />
                <span>Confermo: il profilo attuale del cloud andrà perso.</span></label>
              <Button variant="destructive" disabled={snap.busy || blockedByDraft || !confirmReplace || !newPassphraseOk} onClick={createProfile}>
                Sostituisci il profilo cloud con questo dispositivo</Button>
            </div>
          </>}

          {profile?.exists && !profile.invalid && !neverSynced && !snap.conflict && <>
            <p className="text-sm" role="status">
              {link.dirtyProfile && remoteNewer ? "Le impostazioni sono cambiate sia qui sia nel cloud: scegli quale tenere."
                : remoteNewer ? `Il cloud ha impostazioni più recenti (revisione ${profile.revision}, da «${profile.deviceName}», ${when(profile.updatedAt)}).`
                : link.dirtyProfile ? "Questo dispositivo ha impostazioni non ancora inviate al cloud."
                : `Impostazioni sincronizzate (revisione ${link.profileRevision}${link.lastProfileSyncAt ? ", " + when(link.lastProfileSyncAt) : ""}).`}
            </p>
            {(remoteNewer || link.dirtyProfile || snap.needsPassphrase) && unlockField}
            <div className="flex flex-wrap gap-2">
              {remoteNewer && <Button disabled={snap.busy || blockedByDraft} onClick={applyProfile}>Aggiorna impostazioni dal cloud</Button>}
              {link.dirtyProfile && !remoteNewer && <Button disabled={snap.busy || blockedByDraft} onClick={sendProfile}>Invia impostazioni al cloud</Button>}
              {!remoteNewer && !link.dirtyProfile && <Button variant="outline" disabled={snap.busy} onClick={() => void controller.inspect()}>
                <RefreshCw size={16} /> Controlla il cloud</Button>}
            </div>
          </>}

          {snap.conflict && <div role="alert" className="space-y-2 rounded-lg border border-amber-500/60 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold"><ShieldAlert size={17} /> Il profilo cloud è stato modificato da un altro dispositivo</p>
            <p className="text-sm">Revisione {snap.conflict.remoteRevision || "?"} da «{snap.conflict.remoteDevice}», {when(snap.conflict.remoteUpdatedAt)}.
              Non sovrascrivo niente in automatico: scegli.</p>
            {unlockField}
            <div className="flex flex-wrap gap-2">
              <Button disabled={snap.busy || blockedByDraft} onClick={applyProfile}>Usa il profilo cloud (perdo le mie modifiche)</Button>
            </div>
            {protectionFields}
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 size-4 accent-emerald-600"
              checked={confirmReplace} onChange={e => setConfirmReplace(e.target.checked)} />
              <span>Confermo: il profilo del cloud verrà sostituito dal mio.</span></label>
            <Button variant="destructive" disabled={snap.busy || blockedByDraft || !confirmReplace || !newPassphraseOk} onClick={createProfile}>
              Sostituisci il profilo cloud con questo dispositivo</Button>
          </div>}
        </div>

        <div className="space-y-2 rounded-lg border border-slate-300 p-3 text-sm dark:border-slate-700">
          <h3 className="font-semibold">Libreria nel cloud</h3>
          {inspection?.library.invalid && <div role="alert" className="space-y-2 rounded-lg border border-red-500/50 p-3">
            <p className="text-red-700 dark:text-red-300">L'elenco dei libri nel cloud non è leggibile: {inspection.library.invalid}</p>
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-1 size-4 accent-emerald-600"
              checked={confirmReplace} onChange={e => setConfirmReplace(e.target.checked)} />
              <span>Confermo: cancello l'elenco nel cloud e lo ricreo dai libri di questo dispositivo. I libri su GitHub non sono toccati.</span></label>
            <Button variant="destructive" disabled={snap.busy || !confirmReplace}
              onClick={() => void controller.recreateLibrary().then(() => setConfirmReplace(false))}>Ricrea l'elenco libri cloud</Button>
          </div>}
          <p>{inspection?.library.exists && !inspection.library.invalid
            ? `${snap.library ? snap.library.books.filter(book => !book.removed).length : inspection.library.books ?? 0} libri nell'elenco. Li trovi nella pagina Libreria.`
            : "L'elenco dei libri sarà creato alla prossima sincronizzazione."}
            {link.lastLibrarySyncAt && <span className="muted block text-xs">Ultimo aggiornamento: {when(link.lastLibrarySyncAt)}</span>}</p>
          <Button variant="outline" disabled={snap.busy} onClick={() => void controller.syncLibraryNow()}>
            <RefreshCw size={16} /> Aggiorna elenco libri cloud</Button>
        </div>
      </>}

      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-1 size-5 accent-emerald-600" checked={link.autoSync}
          onChange={e => void controller.setAutoSync(e.target.checked)} />
        <span><b>Sincronizza in automatico</b> l'elenco dei libri e le impostazioni modificate mentre questa pagina è aperta e la connessione è valida.</span>
      </label>
    </div>}

    <details className="rounded-lg border border-slate-300 p-3 text-sm dark:border-slate-700">
      <summary className="min-h-11 cursor-pointer font-semibold">Impostazioni avanzate: Client ID e nome del dispositivo</summary>
      <div className="mt-3 space-y-3">
        <p className="muted text-xs">I Client ID sono identificativi pubblici (non sono segreti). Il sito pubblicato li riceve già dal build; qui puoi sovrascriverli su questo dispositivo, ad esempio per provare una tua app registration.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Client ID Google" value={draft.googleClientId} onChange={value => setDraft({ ...draft, googleClientId: value })}
            placeholder="123456789012-xxxx.apps.googleusercontent.com" />
          <Field label="Application (client) ID Microsoft" value={draft.microsoftClientId}
            onChange={value => setDraft({ ...draft, microsoftClientId: value })} placeholder="00000000-0000-0000-0000-000000000000" />
          <Field label="Tenant Microsoft" value={draft.microsoftTenant} onChange={value => setDraft({ ...draft, microsoftTenant: value })}
            placeholder="common" />
        </div>
        <Button variant="outline" disabled={snap.busy || !!link} onClick={() => void controller.saveConfig(draft)}>Salva Client ID su questo dispositivo</Button>
        {link && <p className="muted text-xs">Scollega il dispositivo prima di cambiare i Client ID.</p>}
        {snap.device && <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="Nome di questo dispositivo" value={deviceName || snap.device.name} onChange={setDeviceName} />
          <Button variant="outline" disabled={snap.busy || !deviceName.trim()} onClick={() => void controller.renameDevice(deviceName)}>Salva nome</Button>
        </div>}
      </div>
    </details>
  </section>;
}
