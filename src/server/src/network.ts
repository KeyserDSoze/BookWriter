import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Readable } from "node:stream";

export function publicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a = 0, b = 0, c = 0] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 ||
      a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 0 || b === 168) ||
      a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19) ||
      a === 192 && b === 0 && c === 2 || a === 192 && b === 88 && c === 99 ||
      a === 198 && b === 51 && c === 100 || a === 203 && b === 0 && c === 113);
  }
  // Conservative native IPv6 global unicast only. Reject transition/mapped, local,
  // multicast and documentation ranges rather than interpreting IPv4 inside them.
  return family === 6 && /^[23][a-f0-9]{3}:/i.test(address) &&
    !(address.toLowerCase().startsWith("2001:") && parseInt(address.split(":")[1] || "0", 16) < 0x200) &&
    !/^2001:db8:/i.test(address) && !/^2002:/i.test(address);
}

const builtInOrigins = new Set(["https://api.github.com", "https://registry.npmjs.org", "https://it.wikipedia.org", "https://en.wikipedia.org"]);
export const isBuiltInOutboundOrigin = (url: URL): boolean => builtInOrigins.has(url.origin);

/** Node-only fetch adapter. DNS is checked AND pinned in the actual connection;
 * checking then calling native fetch would leave a DNS-rebinding race. */
export function installOutboundNetwork(approvedBases: () => string[]): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const configured = approvedBases().some(base => new URL(base).origin === url.origin);
    const fixed = isBuiltInOutboundOrigin(url);
    const loopback = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.username || url.password || url.hash || !configured && !fixed ||
        url.protocol !== "https:" && !(configured && loopback && url.protocol === "http:"))
      throw new Error("Destinazione di rete non autorizzata dall'amministratore.");
    const addresses = loopback ? [{ address: "127.0.0.1", family: 4 }] :
      isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] :
        await lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || !loopback && addresses.some(a => !publicAddress(a.address)))
      throw new Error("Indirizzo di rete riservato o non verificabile.");
    if (init.signal?.aborted) throw new DOMException("Interrotto.", "AbortError");
    const destination = addresses[0]!;
    const headers = new Headers(init.headers);
    const body = init.body;
    if (body !== undefined && body !== null && typeof body !== "string" && !(body instanceof Uint8Array))
      throw new Error("Corpo di rete non supportato dal server.");
    return new Promise<Response>((accept, reject) => {
      const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
        method: init.method ?? "GET", headers: Object.fromEntries(headers),
        signal: init.signal ?? undefined,
        lookup: (_host, options, callback) => {
          if (typeof options === "object" && options.all)
            callback(null, [destination] as never, 0);
          else callback(null, destination.address, destination.family);
        },
      }, incoming => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value === undefined || name === "set-cookie") continue;
          for (const entry of Array.isArray(value) ? value : [value]) responseHeaders.append(name, entry);
        }
        const status = incoming.statusCode ?? 500;
        // Redirects never forward a credential, including on fixed public services.
        if (status >= 300 && status < 400 && status !== 304) {
          incoming.destroy(); reject(new Error("Reindirizzamento di rete non consentito.")); return;
        }
        const stream = [204, 205, 304].includes(status) || init.method === "HEAD" ? null :
          Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
        if (!stream) incoming.resume();
        accept(new Response(stream, { status, headers: responseHeaders }));
      });
      request.once("error", error => reject(init.signal?.aborted
        ? new DOMException("Interrotto.", "AbortError") : new Error("Connessione di rete non riuscita.", { cause: error })));
      if (body) request.write(body);
      request.end();
    });
  };
  return () => { globalThis.fetch = original; };
}
