// The admin panel is served by the server itself under a strict CSP (script-src/style-src 'self'):
// no inline <style>, style attributes, inline handlers or external fonts/images. Icons are inline SVG.
const icon = (paths: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const ICONS = {
  book: icon('<path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2.5Z"/><path d="M19 17v4H6.5"/><path d="M9 7h6"/>'),
  identity: icon('<path d="M12 3 4 6v6c0 4.4 3.4 8.4 8 9 4.6-.6 8-4.6 8-9V6Z"/><path d="m9 12 2 2 4-4"/>'),
  link: icon('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  key: icon('<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9"/><path d="m17 6 3 3"/><path d="m15 8 2 2"/>'),
  network: icon('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/>'),
  cloud: icon('<path d="M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1 0 8Z"/>'),
  lock: icon('<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'),
  refresh: icon('<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>'),
};

export const ADMIN_HTML = `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><title>BookWriter · Server personale</title>
<link rel="stylesheet" href="/admin.css"></head>
<body>
<header class="topbar"><div class="topbar-inner">
  <div class="brand">${ICONS.book}<div><strong>BookWriter</strong><span id="brand-sub">Server personale</span></div></div>
  <div class="pills" id="pills"></div>
</div></header>
<main>
<section id="login-view" class="login-wrap" aria-labelledby="login-title">
  <div class="card login-card">
    <div class="login-icon">${ICONS.lock}</div>
    <h1 id="login-title">Accedi al pannello</h1>
    <p class="lead">Amministrazione del server personale: loopback 24105 di default, oppure l'hostname HTTPS che hai abilitato.
    Il codice è nel file <code>private/admin-bootstrap.txt</code> della cartella dati, oppure lo mostra
    <code>npx bookwriter-personal-server admin-code</code>.</p>
    <form id="login"><label>Codice amministratore <input id="bootstrap" type="password" autocomplete="off" required></label>
    <button class="primary" type="submit">Accedi</button></form>
    <div id="rotated-box" class="secret-block" hidden>
      <p class="callout">Nuovo codice amministratore: copialo ora, non verrà mostrato di nuovo.</p>
      <div class="secret"><code id="bootstrap-rotated"></code><button type="button" data-copy="bootstrap-rotated">Copia</button></div>
    </div>
    <p class="hint">I file del libro e il vault non sono cifrati end-to-end: proteggi l'accesso a questa macchina.</p>
  </div>
</section>

<section id="panel" hidden>
  <div class="page-head">
    <div><h1>Server personale</h1><p class="lead">Client abbinati, rete approvata e connettore Cloudflare di questo server.</p></div>
    <button id="refresh" type="button" class="ghost">${ICONS.refresh}<span>Aggiorna stato</span></button>
  </div>
  <div class="grid">
    <article class="card" aria-labelledby="h-identity">
      <h2 id="h-identity">${ICONS.identity}Identità e connessioni</h2>
      <p class="lead">Confronta l'impronta con quella mostrata dal client durante l'abbinamento.</p>
      <dl class="facts" id="identity"></dl>
    </article>

    <article class="card" aria-labelledby="h-pairing">
      <h2 id="h-pairing">${ICONS.link}Abbina un client</h2>
      <p class="lead">Genera un codice monouso valido 5 minuti, inseriscilo nel client e approva qui la richiesta dopo aver confrontato l'impronta. Il codice da solo non autorizza gli aggiornamenti.</p>
      <div class="actions"><button id="pairing" type="button" class="primary">Abbina un client · codice per 5 minuti</button></div>
      <div id="code-box" class="secret" hidden><code id="code"></code><button type="button" data-copy="code">Copia</button></div>
      <div id="pending" aria-live="polite"></div>
    </article>

    <article class="card wide" aria-labelledby="h-clients">
      <h2 id="h-clients">${ICONS.key}Token dei client</h2>
      <p class="lead">Ogni client usa un token revocabile. Il token viene mostrato una sola volta: copialo nel client, mai in un URL.</p>
      <div id="clients" class="clients"></div>
      <form id="issue" class="inline-form">
        <label>Nome del client <input id="label" maxlength="80" required placeholder="Es. Portatile di casa"></label>
        <label class="check"><input id="update" type="checkbox"> Concedi anche gli aggiornamenti del server (permesso separato)</label>
        <div class="actions"><button type="submit" class="primary">Genera token</button></div>
      </form>
      <div id="token-box" class="secret-block" hidden>
        <p class="callout">Token mostrato una sola volta: copialo adesso nel client BookWriter.</p>
        <div class="secret"><code id="token"></code><button type="button" data-copy="token">Copia</button></div>
      </div>
    </article>

    <article class="card wide" aria-labelledby="h-network">
      <h2 id="h-network">${ICONS.network}Rete approvata</h2>
      <p class="lead">Un URL AI locale indica QUESTO server. Non approvare reti private di altri host. Il servizio non segue redirect.</p>
      <form id="network">
        <div class="two">
          <label>Basi AI approvate, una per riga <textarea id="bases" rows="4" spellcheck="false"></textarea></label>
          <label>Origini client permesse, una per riga <textarea id="origins" rows="4" spellcheck="false"></textarea></label>
        </div>
        <div class="two">
          <label>Origine HTTPS pubblica della API 24106 <input id="public" type="url" placeholder="https://api.esempio.it"></label>
          <label>Origine HTTPS distinta del pannello admin 24105 (facoltativa) <input id="admin-public" type="url" placeholder="https://admin.esempio.it"></label>
        </div>
        <label class="check"><input id="remote-admin" type="checkbox" checked> Rendi visibile il pannello amministrativo su quell'origine HTTPS</label>
        <p class="hint">Il pannello remoto resta protetto da codice, cookie HttpOnly/Secure e CSRF; aggiungi Cloudflare Access per sicurezza. La porta 24105 resta in loopback: il tunnel punta a 24106 per la API, oppure a una route distinta per l'admin 24105.</p>
        <div class="actions"><button type="submit" class="primary">Salva rete approvata</button></div>
      </form>
    </article>

    <article class="card wide" aria-labelledby="h-tunnel">
      <h2 id="h-tunnel">${ICONS.cloud}Cloudflare</h2>
      <p class="lead">Connettore dedicato verso http://127.0.0.1:24106. Il token resta in un token-file protetto su questa macchina e non va mai inserito nel client. Tunnel, servizi e configurazioni già presenti non vengono toccati.</p>
      <dl class="facts" id="tunnel-status"></dl>
      <p id="tunnel-other" class="hint"></p>
      <form id="tunnel-configure">
        <div class="two">
          <label>Token del connettore Cloudflare <input id="tunnel-token" type="password" autocomplete="off" maxlength="4096" required></label>
          <label>Hostname HTTPS pubblico, facoltativo (sola indicazione) <input id="tunnel-hostname" type="url" maxlength="500"></label>
        </div>
        <div class="actions">
          <button type="submit" class="primary">Salva e avvia il connettore dedicato</button>
          <button id="tunnel-restart" type="button">Riavvia solo il connettore dedicato</button>
          <button id="tunnel-remove" type="button" class="danger">Rimuovi il token e arresta il connettore</button>
        </div>
      </form>
      <p class="hint">Serve cloudflared 2025.4.0 o successivo per <code>--token-file</code>. Hostname, route e DNS vanno creati nel pannello Cloudflare; il token deve autorizzare solo questo connector. Nessun comando arbitrario e nessun <code>--url</code>.</p>
    </article>

    <article class="card wide" aria-labelledby="h-admin">
      <h2 id="h-admin">${ICONS.lock}Codice amministratore</h2>
      <p class="lead">Protegge anche l'accesso remoto quando il pannello è pubblicato. Dopo la modifica tutte le sessioni admin si chiudono.</p>
      <details>
        <summary>Cambia il codice amministratore</summary>
        <form id="bootstrap-custom">
          <div class="two">
            <label>Nuovo codice scelto (32–200 caratteri) <input id="bootstrap-new" type="password" autocomplete="new-password" minlength="32" maxlength="200" required></label>
            <label>Ripeti il nuovo codice <input id="bootstrap-confirm" type="password" autocomplete="new-password" minlength="32" maxlength="200" required></label>
          </div>
          <div class="actions">
            <button type="submit" class="primary">Imposta questo codice</button>
            <button id="bootstrap-rotate" type="button">Genera un codice casuale e mostralo una volta</button>
          </div>
        </form>
      </details>
    </article>
  </div>
</section>
</main>
<p id="notice" class="toast" role="status" aria-live="polite" hidden></p>
<script src="/admin.js"></script></body></html>`;

export const ADMIN_CSS = `:root{color-scheme:light dark;
--bg:#f4f6f8;--surface:#fff;--surface-2:#eef1f4;--border:#dde2e8;--text:#1b2230;--muted:#5b6474;
--accent:#0d8a72;--accent-strong:#096b59;--accent-soft:#dff3ee;--on-accent:#fff;
--ok:#1d8a4b;--ok-soft:#e3f5ea;--warn:#a86a10;--warn-soft:#fdf2df;--bad:#c0392b;--bad-soft:#fdeaea;
--radius:14px;--shadow:0 1px 2px rgba(16,24,40,.05),0 6px 20px rgba(16,24,40,.06);
--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;line-height:1.5}
@media (prefers-color-scheme:dark){:root{--bg:#0e1217;--surface:#161b22;--surface-2:#1e252e;--border:#2b333e;
--text:#e7eaef;--muted:#9ba5b3;--accent:#3cc4a6;--accent-strong:#6ad8be;--accent-soft:#12302a;--on-accent:#04201a;
--ok:#4cc38a;--ok-soft:#13301f;--warn:#e2b04b;--warn-soft:#33280f;--bad:#f07a6d;--bad-soft:#3a1c1a;--shadow:0 1px 2px rgba(0,0,0,.4)}}
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text)}
[hidden]{display:none!important}
code{font-family:var(--mono);font-size:.88em;background:var(--surface-2);padding:.1em .35em;border-radius:6px}
h1{font-size:1.5rem;margin:0;letter-spacing:-.01em}
h2{display:flex;align-items:center;gap:.55rem;font-size:1.05rem;margin:0}
h2 svg,.brand svg,.login-icon svg,button svg{width:1.25em;height:1.25em;flex:none}
h2 svg{color:var(--accent)}
.topbar{position:sticky;top:0;z-index:10;background:var(--surface);border-bottom:1px solid var(--border)}
.topbar-inner{max-width:74rem;margin:auto;padding:.7rem 1.25rem;display:flex;align-items:center;gap:1rem;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:.65rem}
.brand svg{width:2rem;height:2rem;color:var(--accent)}
.brand div{display:grid;line-height:1.2}
.brand span{color:var(--muted);font-size:.82rem}
.pills{display:flex;gap:.4rem;flex-wrap:wrap;margin-left:auto}
.pill{display:inline-flex;align-items:center;gap:.4rem;padding:.2rem .7rem;border-radius:999px;font-size:.8rem;font-weight:600;
background:var(--surface-2);color:var(--muted);border:1px solid var(--border);white-space:nowrap}
.pill::before{content:"";width:.5rem;height:.5rem;border-radius:50%;background:currentColor}
.pill.ok{color:var(--ok);background:var(--ok-soft);border-color:transparent}
.pill.warn{color:var(--warn);background:var(--warn-soft);border-color:transparent}
.pill.bad{color:var(--bad);background:var(--bad-soft);border-color:transparent}
main{max-width:74rem;margin:auto;padding:1.5rem 1.25rem 4rem}
.page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:1.25rem}
.grid{display:grid;gap:1.1rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,24rem),1fr))}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:1.25rem 1.35rem;min-width:0}
.card.wide{grid-column:1/-1}
.lead{color:var(--muted);font-size:.93rem;margin:.35rem 0 1rem}
.hint{color:var(--muted);font-size:.85rem;margin:.75rem 0 0}
p,dd{overflow-wrap:anywhere}
.facts{display:grid;grid-template-columns:max-content 1fr;gap:.45rem 1rem;margin:0}
.facts dt{color:var(--muted);font-size:.88rem}
.facts dd{margin:0;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;min-width:0}
.facts .mono{font-family:var(--mono);font-size:.86rem;overflow-wrap:anywhere}
form{display:grid;gap:.9rem;margin:1rem 0 0}
.two{display:grid;gap:.9rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr))}
label{display:grid;gap:.35rem;font-weight:600;font-size:.9rem}
label.check{display:flex;align-items:center;gap:.65rem;font-weight:500}
input,textarea{font:inherit;color:inherit;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:.65rem .8rem;width:100%;min-height:44px}
textarea{resize:vertical;font-family:var(--mono);font-size:.86rem}
input[type=checkbox]{width:22px;height:22px;min-height:0;accent-color:var(--accent);flex:none}
input:focus,textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
button{font:inherit;font-weight:600;min-height:44px;padding:.55rem 1rem;border-radius:10px;border:1px solid var(--border);
background:var(--surface-2);color:var(--text);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:.45rem}
button:hover{border-color:var(--muted)}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
button.primary:hover{background:var(--accent-strong);border-color:var(--accent-strong)}
button.danger{color:var(--bad);border-color:var(--bad-soft);background:var(--bad-soft)}
button.ghost{background:transparent}
button:disabled{opacity:.55;cursor:progress}
.actions{display:flex;gap:.55rem;flex-wrap:wrap;align-items:center}
.secret-block{margin-top:1rem;display:grid;gap:.6rem}
.secret{display:flex;gap:.5rem;align-items:stretch;margin-top:.75rem}
.secret code{flex:1;min-width:0;display:flex;align-items:center;padding:.6rem .8rem;font-size:.95rem;letter-spacing:.02em;
border:1px dashed var(--accent);background:var(--accent-soft);color:var(--text);overflow-wrap:anywhere;word-break:break-all}
.callout{margin:0;border-radius:10px;padding:.7rem .9rem;background:var(--warn-soft);border-left:4px solid var(--warn);font-size:.9rem}
.callout.info{background:var(--accent-soft);border-left-color:var(--accent)}
.callout .actions{margin-top:.6rem}
#pending .callout{margin-top:1rem}
.clients{display:grid}
.client{display:flex;align-items:center;gap:.75rem 1rem;flex-wrap:wrap;padding:.8rem 0;border-top:1px solid var(--border)}
.client:first-child{border-top:0;padding-top:.2rem}
.client .who{display:grid;gap:.15rem;min-width:12rem;flex:1}
.client .name{font-weight:650}
.client .meta{color:var(--muted);font-size:.82rem}
.client.revoked .name{text-decoration:line-through;color:var(--muted)}
.chips{display:flex;gap:.3rem;flex-wrap:wrap}
.chip{font-size:.75rem;font-weight:600;padding:.1rem .55rem;border-radius:999px;background:var(--accent-soft);color:var(--accent-strong)}
.chip.update{background:var(--warn-soft);color:var(--warn)}
.empty{color:var(--muted);font-style:italic;margin:0}
details{border-top:1px solid var(--border);margin-top:.5rem;padding-top:.25rem}
summary{min-height:44px;display:flex;align-items:center;cursor:pointer;font-weight:600}
.login-wrap{min-height:calc(100vh - 9rem);display:grid;place-items:center}
.login-card{width:min(100%,30rem)}
.login-card form{margin-top:1.25rem}
.login-icon{width:3rem;height:3rem;border-radius:12px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent);margin-bottom:.9rem}
.login-icon svg{width:1.6rem;height:1.6rem}
.toast{position:fixed;left:50%;bottom:1.25rem;transform:translateX(-50%);z-index:20;margin:0;max-width:min(92vw,40rem);
padding:.75rem 1.1rem;border-radius:12px;background:var(--text);color:var(--bg);box-shadow:0 8px 30px rgba(0,0,0,.25);font-weight:500}
.toast.error{background:var(--bad);color:#fff}
*:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.offscreen{position:fixed;left:-9999px;top:0;opacity:0}
@media (max-width:40rem){.topbar-inner{padding:.6rem .9rem}.pills{margin-left:0}main{padding:1rem .9rem 4rem}
.facts{grid-template-columns:1fr}.facts dt{margin-top:.35rem}.secret{flex-direction:column}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}`;

// String.raw keeps backslashes literal; the script avoids template literals and "${" on purpose.
export const ADMIN_JS = String.raw`"use strict";
var csrf = "";
var poll = 0;
var noticeTimer = 0;
var dirty = { network: false, tunnel: false };
function el(id) { return document.getElementById(id); }
function make(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function notice(text, kind) {
  var box = el("notice");
  clearTimeout(noticeTimer);
  box.textContent = text || "";
  box.className = "toast" + (kind === "error" ? " error" : "");
  box.hidden = !text;
  if (text) noticeTimer = setTimeout(function () { box.hidden = true; }, kind === "error" ? 10000 : 5000);
}
function SessionExpired() {}
async function call(path, body) {
  var init = { method: body === undefined ? "GET" : "POST", cache: "no-store",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf } };
  if (body !== undefined) init.body = JSON.stringify(body);
  var response = await fetch("/admin/api/" + path, init);
  var data = {};
  try { data = await response.json(); } catch (error) { data = {}; }
  if (response.status === 401 && path !== "login") { signOut("Sessione scaduta: accedi di nuovo."); throw new SessionExpired(); }
  if (!response.ok) throw new Error(data.message || "Operazione non completata.");
  return data;
}
function run(action) {
  return function (event) {
    if (event) event.preventDefault();
    var button = event && event.submitter ? event.submitter : event && event.currentTarget && event.currentTarget.tagName === "BUTTON" ? event.currentTarget : null;
    if (button) button.disabled = true;
    Promise.resolve().then(action).catch(function (error) {
      if (!(error instanceof SessionExpired)) notice(error.message, "error");
    }).finally(function () { if (button) button.disabled = false; });
  };
}
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  var area = make("textarea"); area.value = text; area.setAttribute("readonly", ""); area.className = "offscreen";
  document.body.append(area); area.select();
  try { document.execCommand("copy"); } finally { area.remove(); }
  return Promise.resolve();
}
document.addEventListener("click", function (event) {
  var button = event.target.closest ? event.target.closest("[data-copy]") : null;
  if (!button) return;
  var source = el(button.getAttribute("data-copy"));
  copyText(source ? source.textContent : "").then(function () {
    button.textContent = "Copiato";
    setTimeout(function () { button.textContent = "Copia"; }, 1500);
  }).catch(function () { notice("Copia non riuscita: seleziona il testo e copialo a mano.", "error"); });
});
function showSecret(boxId, codeId, value) { el(codeId).textContent = value; el(boxId).hidden = !value; }
function pill(text, kind) { return make("span", "pill" + (kind ? " " + kind : ""), text); }
function fact(list, label, value, options) {
  list.append(make("dt", "", label));
  var dd = make("dd");
  if (value) {
    var text = make("span", options && options.mono ? "mono" : "", value);
    if (options && options.id) text.id = options.id;
    dd.append(text);
  }
  if (options && options.pill) dd.append(options.pill);
  if (options && options.copy) {
    var copy = make("button", "", "Copia"); copy.type = "button"; copy.setAttribute("data-copy", options.id);
    dd.append(copy);
  }
  list.append(dd);
}
function tunnelState(t) {
  if (t.process === "running") return ["avviato", "ok"];
  if (t.process === "failed") return ["errore", "bad"];
  return [t.configured ? "arrestato" : "non configurato", t.configured ? "warn" : ""];
}
function showTunnel(t) {
  var list = el("tunnel-status"); list.replaceChildren();
  var state = tunnelState(t);
  fact(list, "Connettore", "", { pill: pill(state[0], state[1]) });
  fact(list, "Abilitato", t.enabled ? "sì" : "no");
  fact(list, "Token salvato", t.configured ? "sì" : "no");
  fact(list, "cloudflared", t.binaryAvailable ? "rilevato con versione leggibile" : "non rilevato");
  if (t.hostname) fact(list, "Hostname", t.hostname, { mono: true });
  if (t.lastError) fact(list, "Ultimo errore", t.lastError);
  el("tunnel-other").textContent = t.otherConnectorDetected
    ? "Altri cloudflared già presenti: non vengono modificati e questo connettore BookWriter resta separato."
    : "Nessun altro connettore rilevato. La rilevazione è indicativa e non modifica servizi.";
  if (t.hostname && !dirty.tunnel) el("tunnel-hostname").value = t.hostname;
}
function showPills(s) {
  var pills = el("pills"); pills.replaceChildren();
  pills.append(pill("API :" + s.apiPort, "ok"));
  pills.append(s.git.mode === "git" ? pill("git " + s.git.version, "ok") : pill("GitHub via REST", "warn"));
  var state = tunnelState(s.tunnel);
  pills.append(pill("Cloudflare " + state[0], state[1]));
  if (s.busy) pills.append(pill("Al lavoro", "warn"));
}
function showClients(clients) {
  var box = el("clients"); box.replaceChildren();
  if (!clients.length) { box.append(make("p", "empty", "Nessun client: genera un token o abbina un client.")); return; }
  clients.forEach(function (c) {
    var row = make("div", "client" + (c.revoked ? " revoked" : ""));
    var who = make("div", "who");
    who.append(make("span", "name", c.label));
    var created = typeof c.createdAt === "number" ? "creato il " + new Date(c.createdAt).toLocaleString("it-IT") : "";
    who.append(make("span", "meta", created));
    var chips = make("div", "chips");
    c.scopes.forEach(function (scope) { chips.append(make("span", "chip" + (scope === "update" ? " update" : ""), scope)); });
    row.append(who, chips, c.revoked ? pill("revocato", "bad") : pill("attivo", "ok"));
    if (!c.revoked) {
      var actions = make("div", "actions");
      var renew = make("button", "", "Rigenera"); renew.type = "button";
      renew.onclick = run(async function () {
        if (!confirm("Revocare il token di «" + c.label + "» e mostrarne uno nuovo?")) return;
        var issued = await call("token", { label: c.label, scopes: c.scopes, replaceId: c.id });
        showSecret("token-box", "token", issued.token); await refresh();
        notice("Nuovo token generato: copialo nel client.");
      });
      var revoke = make("button", "danger", "Revoca"); revoke.type = "button";
      revoke.onclick = run(async function () {
        if (!confirm("Revocare il token di «" + c.label + "»? Il client non potrà più collegarsi.")) return;
        await call("revoke", { id: c.id }); await refresh(); notice("Token revocato.");
      });
      actions.append(renew, revoke);
      row.append(actions);
    }
    box.append(row);
  });
}
function showPairing(p) {
  var box = el("pending"); box.replaceChildren();
  if (!p) { el("code-box").hidden = true; return; }
  if (p.requested) {
    var callout = make("div", "callout");
    callout.append(make("p", "", "Richiesta di abbinamento da «" + p.label + "». Confronta l'impronta mostrata nel client con quella di questo server prima di approvare."));
    var actions = make("div", "actions");
    var approve = make("button", "primary", "Approva abbinamento"); approve.type = "button";
    approve.onclick = run(async function () { await call("approve", { id: p.id }); el("code-box").hidden = true; await refresh(); notice("Client abbinato."); });
    actions.append(approve); callout.append(actions); box.append(callout);
  } else if (p.expiresAt) {
    box.append(make("p", "callout info", "Codice attivo fino alle " + new Date(p.expiresAt).toLocaleTimeString("it-IT") + ": in attesa che il client lo usi."));
  }
}
async function refresh(quiet) {
  var s = await call("status");
  el("brand-sub").textContent = "Server personale" + (s.serverVersion ? " · v" + s.serverVersion : "");
  showPills(s);
  var identity = el("identity"); identity.replaceChildren();
  fact(identity, "Server", s.serverId, { mono: true });
  fact(identity, "Impronta", s.fingerprint, { mono: true, id: "fingerprint", copy: true });
  fact(identity, "Porta API", String(s.apiPort));
  if (s.serverVersion) fact(identity, "Versione", s.serverVersion + (s.engineVersion ? " · motore " + s.engineVersion : ""));
  fact(identity, "GitHub", s.git.mode === "git" ? "git " + s.git.version + " (cartelle di lavoro)" : "API REST (" + (s.git.reason || "git non disponibile") + ")");
  if (!dirty.network) {
    el("bases").value = s.allowedAiBases.join("\n");
    el("origins").value = s.origins.join("\n");
    el("public").value = s.publicUrl || "";
    el("admin-public").value = s.adminPublicUrl || "";
    el("remote-admin").checked = s.allowRemoteAdmin !== false;
  }
  showTunnel(s.tunnel);
  showClients(s.clients);
  showPairing(s.pairing);
  if (!quiet) notice("");
}
function signIn() {
  el("login-view").hidden = true; el("panel").hidden = false;
  clearInterval(poll);
  poll = setInterval(function () {
    if (document.visibilityState === "visible" && csrf) refresh(true).catch(function () {});
  }, 20000);
}
function signOut(message) {
  csrf = ""; clearInterval(poll); poll = 0;
  el("panel").hidden = true; el("login-view").hidden = false; el("pills").replaceChildren();
  ["code-box", "token-box"].forEach(function (id) { el(id).hidden = true; });
  if (message) notice(message, "error");
}
["network", "tunnel-configure"].forEach(function (id) {
  el(id).addEventListener("input", function () { dirty[id === "network" ? "network" : "tunnel"] = true; });
});
el("login").onsubmit = run(async function () {
  var session = await call("login", { code: el("bootstrap").value });
  csrf = session.csrf; el("bootstrap").value = ""; el("rotated-box").hidden = true;
  signIn(); await refresh(); notice("Accesso confermato.");
});
el("refresh").onclick = run(async function () { dirty.network = false; dirty.tunnel = false; await refresh(); notice("Stato aggiornato."); });
el("pairing").onclick = run(async function () {
  var pairing = await call("pairing", {});
  showSecret("code-box", "code", pairing.code); await refresh(true);
  notice("Codice monouso valido 5 minuti: il client chiederà anche l'approvazione qui.");
});
el("issue").onsubmit = run(async function () {
  var issued = await call("token", { label: el("label").value, scopes: ["read", "write", "run"].concat(el("update").checked ? ["update"] : []) });
  showSecret("token-box", "token", issued.token); el("label").value = ""; el("update").checked = false;
  await refresh(true); notice("Token generato: copialo nel client.");
});
function bootstrapChanged(message, code) {
  el("bootstrap-new").value = ""; el("bootstrap-confirm").value = "";
  signOut();
  showSecret("rotated-box", "bootstrap-rotated", code || "");
  notice(message);
}
el("bootstrap-custom").onsubmit = run(async function () {
  var code = el("bootstrap-new").value, confirmCode = el("bootstrap-confirm").value;
  if (code !== confirmCode) { notice("I due codici non coincidono.", "error"); return; }
  if (!confirm("Impostare il codice scelto? Tutte le sessioni admin saranno chiuse.")) return;
  await call("bootstrap/set", { code: code });
  bootstrapChanged("Codice scelto attivo. Accedi di nuovo con il nuovo valore.");
});
el("bootstrap-rotate").onclick = run(async function () {
  if (!confirm("Generare e mostrare una sola volta un nuovo codice casuale? Il codice attuale sarà revocato.")) return;
  var result = await call("bootstrap/rotate", {});
  bootstrapChanged("Nuovo codice casuale attivo: copialo subito e accedi di nuovo.", result.code);
});
el("network").onsubmit = run(async function () {
  if (!confirm("Approvi queste destinazioni AI e origini del client?")) return;
  var lines = function (id) { return el(id).value.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean); };
  await call("network", { allowedAiBases: lines("bases"), origins: lines("origins"), publicUrl: el("public").value,
    adminPublicUrl: el("admin-public").value, allowRemoteAdmin: el("remote-admin").checked });
  dirty.network = false; await refresh(true); notice("Rete salvata.");
});
el("tunnel-configure").onsubmit = run(async function () {
  var hostname = el("tunnel-hostname").value.trim();
  var body = { token: el("tunnel-token").value };
  if (hostname) body.hostname = hostname;
  var status = await call("tunnel/configure", body);
  el("tunnel-token").value = ""; dirty.tunnel = false; showTunnel(status); await refresh(true);
  notice(status.process === "running" ? "Connettore Cloudflare dedicato avviato." : "Configurazione salvata: verifica lo stato del connettore.");
});
el("tunnel-restart").onclick = run(async function () {
  showTunnel(await call("tunnel/restart", {})); await refresh(true);
  notice("Riavvio richiesto solo al connettore BookWriter.");
});
el("tunnel-remove").onclick = run(async function () {
  if (!confirm("Rimuovere il token Cloudflare dedicato e arrestare solo il connettore BookWriter?")) return;
  showTunnel(await call("tunnel/remove", {}));
  el("tunnel-token").value = ""; el("tunnel-hostname").value = ""; dirty.tunnel = false; await refresh(true);
  notice("Token dedicato rimosso. Altri tunnel non sono stati modificati.");
});`;
