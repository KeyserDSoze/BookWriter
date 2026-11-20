export const ADMIN_HTML = `<!doctype html>
<html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BookWriter · Server personale</title><link rel="stylesheet" href="/admin.css">
<body><main>
<h1>Server personale BookWriter</h1>
<p>Amministrazione autenticata: loopback 24105 di default, oppure hostname HTTPS esplicito se abilitato. Il file private/admin-bootstrap.txt resta locale. I file del libro e il vault non sono E2EE.</p>
<form id="login"><label>Codice dal file private/admin-bootstrap.txt <input id="bootstrap" type="password" autocomplete="off" required></label>
<button>Accedi</button></form>
<section id="panel" hidden><h2>Identità e connessioni</h2><pre id="identity"></pre>
<button id="refresh" type="button">Aggiorna stato</button>
<details><summary>Codice amministratore</summary>
<p>Il codice protegge anche l'accesso remoto quando questo pannello è pubblicato. Dopo la modifica tutte le sessioni admin si chiudono.</p>
<form id="bootstrap-custom"><label>Nuovo codice scelto (32–200 caratteri) <input id="bootstrap-new" type="password" autocomplete="new-password" minlength="32" maxlength="200" required></label>
<label>Ripeti il nuovo codice <input id="bootstrap-confirm" type="password" autocomplete="new-password" minlength="32" maxlength="200" required></label>
<button>Imposta questo codice</button></form>
<button id="bootstrap-rotate" type="button">Genera un nuovo codice casuale e mostralo una volta</button>
</details>
<button id="pairing" type="button">Abbina un client · codice per 5 minuti</button><pre id="code"></pre>
<div id="pending"></div><h3>Token dei client</h3><div id="clients"></div>
<form id="issue"><label>Nome del client <input id="label" maxlength="80" required></label>
<label><input id="update" type="checkbox"> Concedi anche aggiornamenti (permesso separato)</label><button>Genera token</button></form>
<p>Il token viene mostrato una sola volta. Copialo nel client, non in un URL.</p><pre id="token"></pre>
<h2>Rete approvata</h2><p>Un URL AI locale indica QUESTO server. Non approvare reti private di altri host. Il servizio non segue redirect.</p>
<form id="network"><label>Basi AI approvate, una per riga <textarea id="bases" rows="4" cols="70"></textarea></label>
<label>Origini client permesse, una per riga <textarea id="origins" rows="3" cols="70"></textarea></label>
<label>Origine HTTPS pubblica della API 24106 <input id="public" type="url"></label>
<label>Origine HTTPS distinta del pannello admin 24105 (facoltativa) <input id="admin-public" type="url"></label>
<label><input id="remote-admin" type="checkbox" checked> Rendi visibile il pannello amministrativo su quell'origine HTTPS</label>
<p>Default visibile: la pagina admin resta protetta dal bootstrap/login, cookie HttpOnly/Secure e CSRF. Per sicurezza aggiungi Cloudflare Access. La porta 24105 resta in loopback; il tunnel deve puntare comunque a 24106 per la API, oppure una route distinta per l'admin 24105.</p>
<button>Salva rete approvata</button></form>
<h2>Cloudflare</h2><p>Configura un connettore dedicato verso http://127.0.0.1:24106. Il token Cloudflare resta in un token-file protetto su questa macchina: non inserirlo nel client BookWriter. BookWriter non modifica né riavvia tunnel, servizi o configurazioni già presenti.</p>
<pre id="tunnel-status"></pre><p id="tunnel-other"></p>
<form id="tunnel-configure"><label>Token del connettore Cloudflare <input id="tunnel-token" type="password" autocomplete="off" maxlength="4096" required></label>
<label>Hostname HTTPS pubblico, facoltativo (sola indicazione) <input id="tunnel-hostname" type="url" maxlength="500"></label>
<button>Salva e avvia il connettore dedicato</button></form>
<button id="tunnel-restart" type="button">Riavvia solo il connettore dedicato</button>
<button id="tunnel-remove" type="button">Rimuovi il token dedicato e arresta il connettore</button>
<p>BookWriter richiede cloudflared 2025.4.0 o successivo per <code>--token-file</code>. Nel pannello Cloudflare devono già esistere hostname, route e DNS verso il connettore. Il token deve autorizzare soltanto il connector necessario. Con questa modalità non si usa alcun comando arbitrario e non viene accettato <code>--url</code>.</p>
</section><pre id="bootstrap-rotated"></pre><p id="notice" role="status"></p></main><script src="/admin.js"></script></body></html>`;

export const ADMIN_CSS = `:root{font-family:system-ui,sans-serif;color-scheme:light dark}body{margin:0}
main{max-width:58rem;margin:auto;padding:1.25rem}form{display:grid;gap:.75rem;margin:1rem 0}
label{display:grid;gap:.35rem}input,textarea,button{font:inherit;box-sizing:border-box;max-width:100%}
input,textarea{padding:.65rem}button{min-height:44px;padding:.5rem .8rem;cursor:pointer}
input[type=checkbox]{width:22px;height:22px}pre,p{overflow-wrap:anywhere;white-space:pre-wrap}p button{margin:.25rem}
summary{min-height:44px;cursor:pointer}*:focus-visible{outline:3px solid #0c9;outline-offset:2px}`;

export const ADMIN_JS = `"use strict";
let csrf = "";
const el = id => document.getElementById(id);
const notice = text => { el("notice").textContent = text; };
async function call(path, body) {
 const response = await fetch("/admin/api/" + path, { method: body === undefined ? "GET" : "POST", cache:"no-store",
  headers:{ "Content-Type":"application/json", "X-CSRF-Token":csrf }, ...(body === undefined ? {} : {body:JSON.stringify(body)}) });
 const data = await response.json(); if(!response.ok) throw new Error(data.message || "Operazione non completata."); return data;
}
function run(action) { return event => { event.preventDefault(); Promise.resolve().then(action).catch(e => notice(e.message)); }; }
function showTunnel(t) {
  el("tunnel-status").textContent = "Stato: " + (t.process === "running" ? "avviato" : t.process === "failed" ? "errore" : "arrestato")
    + "\\nAbilitato: " + (t.enabled ? "sì" : "no") + "\\nConfigurato: " + (t.configured ? "sì" : "no")
    + "\\ncloudflared: " + (t.binaryAvailable ? "rilevato con versione leggibile" : "non rilevato")
    + (t.hostname ? "\\nHostname: " + t.hostname : "") + (t.lastError ? "\\n" + t.lastError : "");
  el("tunnel-other").textContent = t.otherConnectorDetected
    ? "Altri cloudflared già presenti: non vengono modificati e questo connettore BookWriter resta separato."
    : "Nessun altro connettore rilevato. La rilevazione è indicativa e non modifica servizi.";
  if(t.hostname) el("tunnel-hostname").value=t.hostname;
}
async function refresh() {
 const s = await call("status");
 el("identity").textContent = "Server: " + s.serverId + "\\nImpronta: " + s.fingerprint + "\\nPorta API: " + s.apiPort + "\\nGitHub: " + (s.git.mode === "git" ? "git " + s.git.version + " (cartelle di lavoro)" : "API REST (" + (s.git.reason || "git non disponibile") + ")");
 el("bases").value = s.allowedAiBases.join("\\n"); el("origins").value = s.origins.join("\\n"); el("public").value = s.publicUrl;
 showTunnel(s.tunnel);
 el("clients").replaceChildren();
 for(const c of s.clients) {
  const p = document.createElement("p"); p.textContent = c.label + " · " + c.scopes.join(", ") + (c.revoked ? " · revocato " : " ");
  if(!c.revoked) {
   const b = document.createElement("button"); b.type="button"; b.textContent="Revoca";
   b.onclick=run(async()=>{await call("revoke",{id:c.id});await refresh();}); p.append(b);
   const r = document.createElement("button"); r.type="button"; r.textContent="Rigenera";
   r.onclick=run(async()=>{if(!confirm("Revocare il token precedente e mostrarne uno nuovo?"))return;
    const n=await call("token",{label:c.label,scopes:c.scopes,replaceId:c.id});el("token").textContent=n.token;await refresh();});p.append(r);
  } el("clients").append(p);
 }
 el("pending").replaceChildren();
 if(s.pairing && s.pairing.requested) {
  const p=document.createElement("p");p.textContent="Richiesta di " + s.pairing.label + ". Confronta l'impronta nel client.";
  const b=document.createElement("button");b.type="button";b.textContent="Approva abbinamento";
  b.onclick=run(async()=>{await call("approve",{id:s.pairing.id});await refresh();});p.append(b);el("pending").append(p);
 }
}
el("login").onsubmit=run(async()=>{const s=await call("login",{code:el("bootstrap").value});csrf=s.csrf;
 el("bootstrap").value="";el("login").hidden=true;el("panel").hidden=false;await refresh();notice("Accesso locale confermato.");});
el("refresh").onclick=run(refresh);
el("pairing").onclick=run(async()=>{const p=await call("pairing",{});el("code").textContent=p.code;notice("Codice monouso. Il client richiederà anche l'approvazione locale.");});
el("issue").onsubmit=run(async()=>{const n=await call("token",{label:el("label").value,scopes:["read","write","run",...(el("update").checked?["update"]:[])]});
 el("token").textContent=n.token;await refresh();});
function bootstrapChanged(message, code="") {
 csrf="";el("panel").hidden=true;el("login").hidden=false;el("bootstrap-new").value="";el("bootstrap-confirm").value="";
 el("bootstrap").value="";el("bootstrap-rotated").textContent=code;notice(message);
}
el("bootstrap-custom").onsubmit=run(async()=>{
 const code=el("bootstrap-new").value, confirmCode=el("bootstrap-confirm").value;
 if(code!==confirmCode) { notice("I due codici non coincidono."); return; }
 if(!confirm("Impostare il codice scelto? Tutte le sessioni admin saranno chiuse.")) return;
 await call("bootstrap/set",{code});bootstrapChanged("Codice scelto attivo. Accedi di nuovo con il nuovo valore.");
});
el("bootstrap-rotate").onclick=run(async()=>{
 if(!confirm("Generare e mostrare una sola volta un nuovo codice casuale? Il codice attuale sarà revocato.")) return;
 const result=await call("bootstrap/rotate",{});bootstrapChanged("Nuovo codice casuale attivo: copialo subito e accedi di nuovo.",result.code);
});
el("network").onsubmit=run(async()=>{if(!confirm("Approvi queste destinazioni AI e origini del client?"))return;
 const lines=id=>el(id).value.split(/\\r?\\n/).map(s=>s.trim()).filter(Boolean);
 await call("network",{allowedAiBases:lines("bases"),origins:lines("origins"),publicUrl:el("public").value,adminPublicUrl:el("admin-public").value,allowRemoteAdmin:el("remote-admin").checked});
 notice("Rete salvata.");await refresh();});
el("tunnel-configure").onsubmit=run(async()=>{
 const hostname=el("tunnel-hostname").value.trim();
 const status=await call("tunnel/configure",{token:el("tunnel-token").value,...(hostname?{hostname}:{})});
 el("tunnel-token").value="";showTunnel(status);notice(status.process === "running" ? "Connettore Cloudflare dedicato avviato." : "Configurazione salvata; verifica lo stato del connettore.");});
el("tunnel-restart").onclick=run(async()=>{showTunnel(await call("tunnel/restart",{}));notice("Riavvio richiesto solo al connettore BookWriter.");});
el("tunnel-remove").onclick=run(async()=>{if(!confirm("Rimuovere il token Cloudflare dedicato e arrestare solo il connettore BookWriter?"))return;
 showTunnel(await call("tunnel/remove",{}));el("tunnel-token").value="";el("tunnel-hostname").value="";notice("Token dedicato rimosso. Altri tunnel non sono stati modificati.");});`;
