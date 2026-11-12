import { readFileSync } from "node:fs";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { authCheck } from "./auth.js";
import { maskSecrets, redactArgs } from "./redact.js";
import { formatJson, formatText, summarize } from "./report.js";
import { diagnose } from "./runner.js";
import { parseSmokeSpec } from "./smoke.js";
import { short } from "./text.js";
import { type Finding, UsageError } from "./types.js";
import { VERSIO } from "./versio.js";

export const EXIT_OK = 0;
export const EXIT_FINDINGS = 1;
export const EXIT_USAGE = 2;
export const EXIT_INTERNAL = 3;

export interface CliIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  env: Record<string, string | undefined>;
  readFile: (path: string) => string;
}

export const USAGE = `mcp-doctor - MCP-palvelimen terveystarkastus

Käyttö:
  mcp-doctor [valinnat] -- <komento> [argumentit...]     stdio-palvelin
  mcp-doctor [valinnat] --url <http(s)-osoite>           HTTP-palvelin (Streamable HTTP)

Valinnat:
  --smoke <tiedosto>     savuajo: kutsuu vain tiedostossa nimetyt työkalut
  --json                 tulosta raportti JSONina
  --strict               varoituksetkin kaatavat ajon (exit 1)
  --timeout-ms <luku>    yksittäisen pyynnön aikakatkaisu, oletus 10000
  --max-tokens <luku>    tokenimittarin raja: työkalumäärittelyjen arvioitu yhteiskoko ei saa ylittää tätä (ylitys on virhe)
  --total-timeout-ms <luku>
                         kättelyn, listauksen ja savuajon yhteinen aikaraja (ei koske --auth-tarkistusta), oletus ei rajaa
  --env <NIMI>           välitä ympäristömuuttuja stdio-palvelimelle (toistettava)
  --bearer-env <NIMI>    lue HTTP-palvelimen Bearer-token tästä ympäristömuuttujasta
  --auth                 HTTP-palvelimen OAuth-tarkistus: 401 ja WWW-Authenticate, resurssin ja valtuutuspalvelimen
                         metatiedot, PKCE S256, refresh_token (kirjautumattomat pyynnöt, myös valtuutuspalvelimelle)
  --version              tulosta versio
  --help                 tämä ohje

Poistumiskoodit: 0 kunnossa, 1 löydöksiä (virhe, tai varoitus --strict-tilassa), 2 käyttö- tai tiedostovirhe, 3 odottamaton sisäinen virhe.
`;

/** Suurin aikaraja, jonka Noden ajastin hyväksyy (2^31 − 1 ms, noin 24,8 vrk). Suuremmalla arvolla
 * setTimeout ja AbortSignal.timeout laukeavat 1 ms:n kuluttua, jolloin terve palvelin näyttäisi
 * aikakatkaistulta (CONNECT_FAILED). */
export const MAX_TIMEOUT_MS = 2_147_483_647;

interface Args {
  command: string[];
  flags: Map<string, string[]>;
  bools: Set<string>;
}

const BOOL_FLAGS = new Set(["json", "strict", "help", "version", "auth"]);
const VALUE_FLAGS = new Set(["smoke", "timeout-ms", "env", "bearer-env", "url", "max-tokens", "total-timeout-ms"]);

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string[]>();
  const bools = new Set<string>();
  let command: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      command = argv.slice(i + 1);
      break;
    }
    if (!a.startsWith("--")) throw new UsageError(`Odottamaton argumentti '${a}' (palvelimen komento tulee '--'-merkin jälkeen)`);
    const name = a.slice(2);
    if (BOOL_FLAGS.has(name)) bools.add(name);
    else if (VALUE_FLAGS.has(name)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new UsageError(`Valinta --${name} tarvitsee arvon`);
      flags.set(name, [...(flags.get(name) ?? []), v]);
    } else throw new UsageError(`Tuntematon valinta --${name}`);
  }
  return { command, flags, bools };
}

function one(args: Args, name: string): string | undefined {
  const v = args.flags.get(name);
  if (!v) return undefined;
  if (v.length > 1) throw new UsageError(`Valinta --${name} saa esiintyä vain kerran`);
  return v[0];
}

/** Ajaa komentorivin ja palauttaa poistumiskoodin. Ei kutsu process.exit-funktiota. */
export async function main(argv: string[], io: CliIo): Promise<number> {
  // Tunnetut salaiset arvot (--env-arvot ja Bearer-token): peitetään kaikesta tulosteesta.
  const secrets: string[] = [];
  try {
    // Vain '--'-merkkiä edeltävät argumentit ovat meidän: palvelimen oma '--help' ei saa laukaista ohjetta.
    const ennenErotinta = argv.includes("--") ? argv.slice(0, argv.indexOf("--")) : argv;
    if (ennenErotinta.includes("--version")) {
      io.stdout(`${VERSIO}\n`);
      return EXIT_OK;
    }
    if (ennenErotinta.includes("--help")) {
      io.stdout(USAGE);
      return EXIT_OK;
    }
    if (argv.length === 0) {
      io.stderr(USAGE);
      return EXIT_USAGE;
    }
    const args = parseArgs(argv);
    const url = one(args, "url");
    if (url !== undefined && args.command.length > 0) throw new UsageError("Anna joko --url tai komento '--'-merkin jälkeen, ei molempia");
    if (url === undefined && args.command.length === 0) throw new UsageError("Anna palvelin: --url <osoite> tai komento '--'-merkin jälkeen");
    const timeoutRaw = one(args, "timeout-ms");
    const timeoutMs = timeoutRaw === undefined ? 10000 : Number(timeoutRaw);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new UsageError("--timeout-ms täytyy olla positiivinen kokonaisluku");
    if (timeoutMs > MAX_TIMEOUT_MS) throw new UsageError(`--timeout-ms saa olla enintään ${MAX_TIMEOUT_MS} (noin 24,8 vrk)`);
    const maxTokensRaw = one(args, "max-tokens");
    const maxTokens = maxTokensRaw === undefined ? undefined : Number(maxTokensRaw);
    if (maxTokens !== undefined && (!Number.isInteger(maxTokens) || maxTokens < 1)) throw new UsageError("--max-tokens täytyy olla positiivinen kokonaisluku");
    const totalRaw = one(args, "total-timeout-ms");
    const totalTimeoutMs = totalRaw === undefined ? undefined : Number(totalRaw);
    if (totalTimeoutMs !== undefined && (!Number.isInteger(totalTimeoutMs) || totalTimeoutMs < 1)) throw new UsageError("--total-timeout-ms täytyy olla positiivinen kokonaisluku");
    if (totalTimeoutMs !== undefined && totalTimeoutMs > MAX_TIMEOUT_MS) throw new UsageError(`--total-timeout-ms saa olla enintään ${MAX_TIMEOUT_MS} (noin 24,8 vrk)`);

    const smokePath = one(args, "smoke");
    let smoke;
    if (smokePath !== undefined) {
      let text: string;
      try {
        text = io.readFile(smokePath);
      } catch {
        throw new UsageError(`Savuajotiedostoa '${smokePath}' ei voi lukea`);
      }
      smoke = parseSmokeSpec(text);
    }

    if (args.bools.has("auth") && url === undefined) throw new UsageError("--auth koskee vain --url-palvelinta");

    let transport: Transport;
    let target: string;
    let stderrTail: (() => string) | undefined;
    if (url !== undefined) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new UsageError(`Virheellinen osoite '${url}'`);
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new UsageError("--url: vain http ja https sallitaan");
      if (args.flags.has("env")) throw new UsageError("--env koskee vain stdio-palvelinta");
      const bearerEnv = one(args, "bearer-env");
      let requestInit: RequestInit | undefined;
      if (bearerEnv !== undefined) {
        const token = io.env[bearerEnv];
        if (!token) throw new UsageError(`Ympäristömuuttuja ${bearerEnv} on tyhjä tai puuttuu`);
        secrets.push(token);
        requestInit = { headers: { Authorization: `Bearer ${token}` } };
        if (parsed.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
          io.stderr(`Varoitus: Bearer-token lähetetään salaamattomana (http) osoitteeseen ${parsed.hostname}. Käytä https:ää.\n`);
        }
      }
      transport = new StreamableHTTPClientTransport(parsed, requestInit ? { requestInit } : undefined);
      target = `${parsed.origin}${parsed.pathname}`; // ei kyselyparametreja eikä tunnuksia tulosteisiin
    } else {
      if (args.flags.has("bearer-env")) throw new UsageError("--bearer-env koskee vain --url-palvelinta");
      const env: Record<string, string> = {};
      for (const name of args.flags.get("env") ?? []) {
        const v = io.env[name];
        if (v === undefined) throw new UsageError(`Ympäristömuuttujaa ${name} ei ole asetettu`);
        env[name] = v;
        secrets.push(v);
      }
      const [command, ...rest] = args.command;
      const stdio = new StdioClientTransport({ command, args: rest, env: { ...getSafeEnv(io.env), ...env }, stderr: "pipe" });
      let tail = "";
      stdio.stderr?.on("data", (d: Buffer | string) => {
        // Peitetään ennen katkaisua, jotta 1000 merkin raja ei jätä salaisen arvon loppuosaa näkyviin.
        tail = maskSecrets(tail + d.toString(), secrets).slice(-1000);
      });
      stderrTail = () => tail;
      transport = stdio;
      target = redactArgs(args.command).join(" "); // salaiselta näyttävät argumentit peitetään tulosteista
    }

    const strict = args.bools.has("strict");
    const authFindings = args.bools.has("auth") && url !== undefined ? await authCheck(url, (u, init) => fetch(u, init), timeoutMs) : [];
    let report = await diagnose({ transport, target, smoke, timeoutMs, totalTimeoutMs, strict, maxTokens, stderrTail });
    if (authFindings.length > 0) {
      // Kun palvelin vaati kirjautumisen (401) eikä tokenia annettu, kirjautumaton yhteys epäonnistuu odotetusti.
      // Se ei ole vika, joten CONNECT_FAILED muutetaan tiedoksi (muuten jokainen OAuth-palvelin näyttäisi rikkinäiseltä).
      const loginRequired = !args.flags.has("bearer-env") && !authFindings.some((x) => x.id === "AUTH_NOT_REQUIRED" || x.id === "AUTH_FORBIDDEN" || x.id === "AUTH_CHECK_FAILED");
      const rest = loginRequired
        ? report.findings.map((x): Finding => (x.id === "CONNECT_FAILED"
          ? { id: "AUTH_LOGIN_REQUIRED", severity: "info", message: "palvelin vaatii kirjautumisen: varsinaista tarkastusta ei voi ajaa ilman tokenia (--bearer-env)" }
          : x))
        : report.findings;
      const findings = [...authFindings, ...rest];
      const summary = summarize(findings);
      report = { ...report, findings, summary, ok: summary.errors === 0 && (!strict || summary.warnings === 0) };
    }
    io.stdout(maskSecrets(args.bools.has("json") ? formatJson(report) : formatText(report), secrets));
    return report.ok ? EXIT_OK : EXIT_FINDINGS;
  } catch (err) {
    if (err instanceof UsageError) {
      io.stderr(`Virhe: ${err.message}\n\n${USAGE}`);
      return EXIT_USAGE;
    }
    io.stderr(maskSecrets(`Odottamaton virhe: ${short(err instanceof Error ? err.message : String(err))}\n`, secrets));
    return EXIT_INTERNAL;
  }
}

/** Vain PATH ja perusmuuttujat: tarkastettava palvelin ei näe muuta ympäristöä kuin --env:llä nimetyn. */
function getSafeEnv(env: Record<string, string | undefined>): Record<string, string> {
  const keep = process.platform === "win32"
    ? ["PATH", "PATHEXT", "SYSTEMROOT", "COMSPEC", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH"]
    : ["PATH", "HOME", "LANG", "TMPDIR", "SHELL", "USER"];
  const out: Record<string, string> = {};
  for (const k of keep) {
    const v = env[k];
    if (v !== undefined && !v.startsWith("()")) out[k] = v;
  }
  return out;
}

export function realIo(): CliIo {
  return {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    env: process.env,
    readFile: (p) => readFileSync(p, "utf8"),
  };
}
