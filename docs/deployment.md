# Deploy su ghostwriting.ws

## Dominio

BookWriter è pubblicato da GitHub Pages mediante GitHub Actions, con dominio **https://ghostwriting.ws** già assegnato dall'autore nelle impostazioni della repository.

- La base Vite è `/`: il dominio personalizzato non richiede la base `/BookWriter/`.
- Il file `src/frontend/public/CNAME` documenta il nome del dominio nell'output statico, ma nel deploy GitHub Actions la configurazione del dominio è **quella di Settings → Pages**, non quel file.
- La Pages source deve essere `GitHub Actions` con HTTPS abilitato; è possibile che l'emissione certificato e la propagazione DNS richiedano tempo.
- L'app è una SPA senza router basato su history, quindi non dipende da rewrite di URL per navigare fra pagine.
- Le autorizzazioni OAuth (quando implementate) dovranno includere l'origine `https://ghostwriting.ws` e, nel caso Microsoft, il redirect URI SPA esatto. Non mettere client secrets nel bundle.
- Il progetto e i contenuti del bundle restano pubblici: il login OAuth non costituisce una misura per nascondere HTML/JS.

## Deploy

La PR passa `Frontend CI`; dopo merge su `main` il workflow `Deploy BookWriter Pages` esegue build e publish.
La versione mostrata nell'interfaccia deriva da `src/frontend/package.json`; in passato il footer riportava ancora il testo statico «v0.3.0» nonostante release successive già pubblicate. La versione visibile è un riferimento al bundle effettivamente caricato, **non** alla data di aggiornamento di una scheda IndexedDB.
Dopo il deploy, in caso di scritta precedente, aggiornare la pagina forzando il caricamento delle risorse (ad esempio Ctrl+Shift+R, o ricaricamento completo da browser mobile); la cache e la propagazione CDN potrebbero non essere istantanee. Il browser potrebbe non essere raggiungibile dagli ambienti CI e il successo del workflow non dimostra disponibilità DNS/HTTPS sul dispositivo dell'autore.
I branch di PR integrate sono eliminati da [Cleanup merged branches](../.github/workflows/cleanup-merged-branches.yml) con verifiche sulla PR e lo SHA; guida [pulizia branch](branch-maintenance.md).
 Verificare status e URL del deployment nelle Actions e aprire manualmente il dominio per smoke test mobile e desktop.

La presenza di una pagina in rete **non equivale** a sincronizzazione cloud, export editoriali o login multi-provider pronti; controllare `docs/local-development.md` e le feature.
