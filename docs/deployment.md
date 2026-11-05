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

La PR passa `Frontend CI`; dopo merge su `main` il workflow `Deploy BookWriter Pages` esegue build e publish. Verificare status e URL del deployment nelle Actions e aprire manualmente il dominio per smoke test mobile e desktop.

La presenza di una pagina in rete **non equivale** a sincronizzazione cloud, export editoriali o login multi-provider pronti; controllare `docs/local-development.md` e le feature.
