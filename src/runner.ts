import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { lintTools } from "./lint.js";
import { summarize } from "./report.js";
import { measureTools, tokenFindings } from "./tokens.js";
import { short } from "./text.js";
import { VERSIO } from "./versio.js";
import type { Finding, Report, SmokeCall, SmokeResult, ToolLike } from "./types.js";

export interface DiagnoseOptions {
  transport: Transport;
  target: string;
  smoke?: SmokeCall[];
  timeoutMs: number;
  /** Koko tarkastuksen aikaraja (kättely, listaus ja savuajo yhteensä). Puuttuessa vain pyyntökohtainen raja. */
  totalTimeoutMs?: number;
  strict: boolean;
  /** Tokenimittarin raja (--max-tokens): ylitys on virhe. */
  maxTokens?: number;
  /** Palauttaa viimeisimmän palvelimen stderr-tekstin (vain stdio), liitetään yhteysvirheeseen. */
  stderrTail?: () => string;
}

const MAX_PAGES = 50;

function errText(e: unknown): string {
  return short(e instanceof Error ? e.message : String(e));
}

/** HTTP-tila, jos yhteysvirhe on SDK:n StreamableHTTPError (code = tilakoodi). Muu virhe ei anna tilaa. */
function httpStatusOf(e: unknown): number | undefined {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "number" && Number.isInteger(code) && code >= 400 && code <= 599 ? code : undefined;
}

/** Selkeä vihje, kun palvelin esti pyynnön tilalla 401 tai 403. Ei ehdota eston kiertämistä. */
function blockedHint(status: number): string {
  if (status === 401) {
    return "palvelin vaatii kirjautumisen. Anna token --bearer-env-valinnalla tai aja --auth, joka näyttää palvelimen OAuth-tiedot";
  }
  return "palvelin esti pyynnön eikä ota sitä vastaan tällä tunnisteella tai tästä verkosta (esim. puuttuva oikeus, IP-rajaus tai bottisuoja). Tarkista token ja oikeudet (--bearer-env) tai aja --auth nähdäksesi, vaatiiko palvelin OAuth-kirjautumisen. mcp-doctor ei yritä kiertää estoa";
}

function firstText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  for (const c of content) {
    if (c && typeof c === "object" && (c as { type?: unknown }).type === "text" && typeof (c as { text?: unknown }).text === "string") {
      return short((c as { text: string }).text);
    }
  }
  return "";
}

function build(opts: DiagnoseOptions, server: Report["server"], toolCount: number, findings: Finding[], smoke: SmokeResult[], tokens?: Report["tokens"]): Report {
  const summary = summarize(findings);
  const ok = summary.errors === 0 && (!opts.strict || summary.warnings === 0);
  const base = { version: 1 as const, target: opts.target, server, toolCount, findings, smoke };
  return tokens ? { ...base, tokens, summary, ok } : { ...base, summary, ok };
}

/** Yhdistää palvelimeen, tarkistaa työkalut ja ajaa savuajon. Ei koskaan heitä: virheet ovat löydöksiä. */
export async function diagnose(opts: DiagnoseOptions): Promise<Report> {
  const findings: Finding[] = [];
  const smokeResults: SmokeResult[] = [];
  // Huom: SDK:n asiakas tarkistaa itse outputSchema-vaatimuksen (puuttuva tai virheellinen structuredContent
  // heittää virheen), ja se näkyy löydöksenä SMOKE_CALL_FAILED.
  const client = new Client({ name: "mcp-doctor", version: VERSIO });
  // Kokonaisaikaraja: jokaisen pyynnön aikakatkaisu on pienempi pyyntökohtaisesta rajasta ja jäljellä olevasta ajasta.
  const deadline = opts.totalTimeoutMs !== undefined ? Date.now() + opts.totalTimeoutMs : undefined;
  const overBudget = () => deadline !== undefined && Date.now() >= deadline;
  const requestTimeout = () => (deadline === undefined ? opts.timeoutMs : Math.max(1, Math.min(opts.timeoutMs, deadline - Date.now())));
  const markTotal = (what: string) => {
    if (findings.some((f) => f.id === "TOTAL_TIMEOUT")) return;
    findings.push({ id: "TOTAL_TIMEOUT", severity: "error", message: `kokonaisaikaraja ${opts.totalTimeoutMs} ms ylittyi: ${what}` });
  };
  try {
    try {
      await client.connect(opts.transport, { timeout: requestTimeout() });
    } catch (e) {
      const tail = opts.stderrTail?.().trim();
      const extra = tail ? ` | palvelimen stderr: ${short(tail)}` : "";
      const status = httpStatusOf(e);
      const blocked = status === 401 || status === 403 ? ` | HTTP ${status}: ${blockedHint(status)}` : "";
      findings.push({ id: "CONNECT_FAILED", severity: "error", message: `yhteys tai initialize-kättely epäonnistui: ${errText(e)}${blocked}${extra}` });
      if (overBudget()) markTotal("kättely ei valmistunut ajoissa");
      return build(opts, null, 0, findings, smokeResults);
    }

    const info = client.getServerVersion();
    const server = info ? { name: String(info.name), version: String(info.version) } : null;
    if (!server || !server.name) {
      findings.push({ id: "SERVER_INFO_MISSING", severity: "warning", message: "palvelin ei kertonut nimeään ja versiotaan (serverInfo)" });
    }

    const caps = client.getServerCapabilities();
    const tools: ToolLike[] = [];
    // Tosi, kun työkalulistaa ei saatu (kyky puuttuu tai tools/list epäonnistui): savuajon "työkalua ei löydy" ei silloin tarkoita, että työkalua ei ole.
    let toolListMissing = false;
    let tokens: Report["tokens"];
    if (!caps?.tools) {
      toolListMissing = true;
      findings.push({ id: "TOOLS_CAPABILITY_MISSING", severity: "warning", message: "palvelin ei ilmoita tools-kykyä, työkaluja ei listata" });
    } else {
      let cursor: string | undefined;
      let pages = 0;
      const seenCursors = new Set<string>();
      try {
        do {
          if (overBudget()) {
            markTotal(`työkalulistaus keskeytettiin ${pages} sivun jälkeen`);
            // Listaus jäi kesken, joten se on epäonnistunut eikä tyhjä (muuten alla tulisi väärä TOOLS_EMPTY).
            findings.push({ id: "TOOLS_LIST_FAILED", severity: "error", message: `tools/list jäi kesken kokonaisaikarajan vuoksi (${pages} sivua haettu)` });
            toolListMissing = true;
            cursor = undefined;
            break;
          }
          const res = await client.listTools(cursor ? { cursor } : undefined, { timeout: requestTimeout() });
          tools.push(...(res.tools as ToolLike[]));
          cursor = res.nextCursor;
          pages++;
          if (cursor) {
            if (seenCursors.has(cursor)) {
              findings.push({ id: "TOOLS_PAGINATION_LOOP", severity: "warning", message: `palvelin palautti saman nextCursor-arvon uudelleen, työkalulistaus keskeytettiin ${pages} sivun jälkeen` });
              cursor = undefined;
              break;
            }
            seenCursors.add(cursor);
          }
        } while (cursor && pages < MAX_PAGES);
        if (cursor) findings.push({ id: "TOOLS_PAGINATION_LIMIT", severity: "warning", message: `työkalulistaus keskeytettiin ${MAX_PAGES} sivun jälkeen` });
      } catch (e) {
        toolListMissing = true;
        findings.push({ id: "TOOLS_LIST_FAILED", severity: "error", message: `tools/list epäonnistui: ${errText(e)}` });
        if (overBudget()) markTotal("tools/list ei valmistunut ajoissa");
      }
      if (tools.length === 0 && !findings.some((f) => f.id === "TOOLS_LIST_FAILED")) {
        findings.push({ id: "TOOLS_EMPTY", severity: "warning", message: "palvelin ilmoittaa tools-kyvyn mutta työkalulista on tyhjä" });
      }
      findings.push(...lintTools(tools));
      if (!toolListMissing) {
        tokens = measureTools(tools, opts.maxTokens);
        findings.push(...tokenFindings(tokens));
      }
    }

    const byName = new Map(tools.map((t) => [t.name, t]));
    const calls = opts.smoke ?? [];
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      if (overBudget()) {
        const rest = calls.slice(i);
        markTotal(`savuajosta ohitettiin ${rest.length} kutsua (${rest.map((c) => c.tool).join(", ")})`);
        for (const c of rest) smokeResults.push({ tool: c.tool, ok: false, ms: 0 });
        break;
      }
      const tool = byName.get(call.tool);
      if (!tool) {
        const syy = toolListMissing
          ? "työkalulistaa ei saatu (tools/list epäonnistui tai tools-kyky puuttuu), joten savuajon työkalua ei voitu etsiä"
          : "savuajotiedostossa nimetty työkalu ei ole palvelimen listalla";
        findings.push({ id: "SMOKE_TOOL_NOT_FOUND", severity: "error", tool: call.tool, message: syy });
        smokeResults.push({ tool: call.tool, ok: false, ms: 0 });
        continue;
      }
      const start = Date.now();
      let ok = true;
      const fail = (id: string, severity: Finding["severity"], message: string) => {
        findings.push({ id, severity, tool: call.tool, message });
        if (severity === "error") ok = false;
      };
      try {
        const res = await client.callTool({ name: call.tool, arguments: call.arguments }, undefined, { timeout: requestTimeout() });
        const ms = Date.now() - start;
        const isError = res.isError === true;
        if (isError && !call.expectError) fail("SMOKE_TOOL_ERROR", "error", `työkalu palautti virheen: ${firstText(res.content) || "(ei tekstiä)"}`);
        else if (!isError && call.expectError) fail("SMOKE_EXPECTED_ERROR", "error", "työkalun odotettiin palauttavan virheen, mutta kutsu onnistui");
        if (!isError) {
          const hasContent = Array.isArray(res.content) && res.content.length > 0;
          if (!hasContent && res.structuredContent === undefined) fail("SMOKE_EMPTY_RESULT", "warning", "työkalu palautti tyhjän tuloksen");
        }
        if (ms > call.maxMs) fail("SMOKE_SLOW", "warning", `vastaus kesti ${ms} ms (raja ${call.maxMs} ms)`);
        smokeResults.push({ tool: call.tool, ok, ms });
      } catch (e) {
        // JSON-RPC-virhe (esim. -32602 Invalid params) on protokollatason tapa kertoa virheestä. Kun virhe odotetaan, se kelpaa;
        // aikakatkaisu ja katkennut yhteys eivät ole odotettu virhe.
        const protocolError = e instanceof McpError && e.code !== ErrorCode.RequestTimeout && e.code !== ErrorCode.ConnectionClosed;
        if (protocolError && call.expectError) {
          fail("SMOKE_EXPECTED_PROTOCOL_ERROR", "info", `odotettu virhe tuli JSON-RPC-virheenä (${e.code}), ei isError-vastauksena: ${errText(e)}`);
        } else {
          fail("SMOKE_CALL_FAILED", "error", `kutsu epäonnistui: ${errText(e)}`);
        }
        if (overBudget()) markTotal(`savuajon kutsu ${call.tool} ei valmistunut ajoissa`);
        smokeResults.push({ tool: call.tool, ok, ms: Date.now() - start });
      }
    }
    return build(opts, server, tools.length, findings, smokeResults, tokens);
  } finally {
    await client.close().catch(() => undefined);
  }
}
