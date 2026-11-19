export const ADMIN_HTML = `<!doctype html>
<html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BookWriter · Server personale</title><link rel="stylesheet" href="/admin.css">
<body><main>
<h1>Server personale BookWriter</h1>
<p>Amministrazione solo locale. Non inoltrare la porta 24105 nel tunnel. I file del libro e il vault non sono E2EE.</p>
<form id="login"><label>Codice dal file private/admin-bootstrap.txt <input id="bootstrap" type="password" autocomplete="off" required></label>
<button>Accedi</button></form>
<section id="panel" hidden><h2>Identità e connessioni</h2><pre id="identity"></pre>
<button id="refresh" type="button">Aggiorna stato</button>
<button id="pairing" type="button">Abbina un client · codice per 5 minuti</button><pre id="code"></pre>
<div id="pending"></div><h3>Token dei client</h3><div id="clients"></div>
<form id="issue"><label>Nome del client <input id="label" maxlength="80" required></label>
<label><input id="update" type="checkbox"> Concedi anche aggiornamenti (permesso separato)</label><button>Genera token</button></form>
<p>Il token viene mostrato una sola volta. Copialo nel client, non in un URL.</p><pre id="token"></pre>
<h2>Rete approvata</h2><p>Un URL AI locale indica QUESTO server. Non approvare reti private di altri host. Il servizio non segue redirect.</p>
<form id="network"><label>Basi AI approvate, una per riga <textarea id="bases" rows="4" cols="70"></textarea></label>
<label>Origini client permesse, una per riga <textarea id="origins" rows="3" cols="70"></textarea></label>
<label>Origine HTTPS pubblica del tunnel API <input id="public" type="url"></label><button>Salva rete approvata</button></form>
<h2>Cloudflare</h2><p>Configura un tunnel dedicato verso http://127.0.0.1:24106. Il token Cloudflare resta in un token-file protetto su questa macchina: non inserirlo nel client BookWriter. Questo pannello non modifica né riavvia i tunnel esistenti.</p>
</section><p id="notice" role="status"></p></main><script src="/admin.js"></script></body></html>`;

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
async function refresh() {
 const s = await call("status");
 el("identity").textContent = "Server: " + s.serverId + "\\nImpronta: " + s.fingerprint + "\\nPorta API: " + s.apiPort;
 el("bases").value = s.allowedAiBases.join("\\n"); el("origins").value = s.origins.join("\\n"); el("public").value = s.publicUrl;
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
el("network").onsubmit=run(async()=>{if(!confirm("Approvi queste destinazioni AI e origini del client?"))return;
 const lines=id=>el(id).value.split(/\\r?\\n/).map(s=>s.trim()).filter(Boolean);
 await call("network",{allowedAiBases:lines("bases"),origins:lines("origins"),publicUrl:el("public").value});
 notice("Rete salvata.");await refresh();});`;
