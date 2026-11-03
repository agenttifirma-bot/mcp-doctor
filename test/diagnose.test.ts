import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { formatText } from "../src/report.js";
import { diagnose } from "../src/runner.js";
import type { SmokeCall } from "../src/types.js";
import { NODE, fixture } from "./helpers.js";

function run(file: string, smoke?: SmokeCall[], timeoutMs = 10000, strict = false) {
  let tail = "";
  const transport = new StdioClientTransport({ command: NODE, args: [fixture(file)], stderr: "pipe" });
  transport.stderr?.on("data", (d: Buffer) => void (tail += d.toString()));
  return diagnose({ transport, target: file, smoke, timeoutMs, strict, stderrTail: () => tail });
}

const call = (tool: string, args: Record<string, unknown> = {}, extra: Partial<SmokeCall> = {}): SmokeCall => ({
  tool,
  arguments: args,
  expectError: false,
  maxMs: 5000,
  ...extra,
});

describe("diagnose: kunnossa oleva palvelin", () => {
  it("löytää palvelimen tiedot ja työkalut ilman löydöksiä", async () => {
    const r = await run("good-server.mjs");
    expect(r.server).toEqual({ name: "hyva-palvelin", version: "1.2.3" });
    expect(r.toolCount).toBe(5);
    expect(r.findings).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("savuajo onnistuu ja tallentaa vasteajan", async () => {
    const r = await run("good-server.mjs", [call("greet", { name: "Tony" }), call("add", { a: 1, b: 2 })]);
    expect(r.findings).toEqual([]);
    expect(r.smoke.map((s) => [s.tool, s.ok])).toEqual([["greet", true], ["add", true]]);
    expect(r.smoke[0].ms).toBeGreaterThanOrEqual(0);
  });

  it("työkalun virhe on virhe, ellei sitä odoteta", async () => {
    const r = await run("good-server.mjs", [call("always_fails")]);
    const f = r.findings.find((x) => x.id === "SMOKE_TOOL_ERROR");
    expect(f?.message).toContain("ei onnistu");
    expect(r.ok).toBe(false);
    expect(r.smoke[0].ok).toBe(false);
  });

  it("odotettu virhe (expectError) menee läpi", async () => {
    const r = await run("good-server.mjs", [call("always_fails", {}, { expectError: true })]);
    expect(r.findings).toEqual([]);
    expect(r.smoke[0].ok).toBe(true);
  });

  it("odotettu virhe, joka ei tule, on virhe", async () => {
    const r = await run("good-server.mjs", [call("greet", { name: "x" }, { expectError: true })]);
    expect(r.findings.map((f) => f.id)).toContain("SMOKE_EXPECTED_ERROR");
    expect(r.ok).toBe(false);
  });

  it("tyhjä tulos on varoitus: ok true, mutta --strict kaataa", async () => {
    const r = await run("good-server.mjs", [call("empty_result")]);
    expect(r.findings.map((f) => f.id)).toEqual(["SMOKE_EMPTY_RESULT"]);
    expect(r.ok).toBe(true);
    const strict = await run("good-server.mjs", [call("empty_result")], 10000, true);
    expect(strict.ok).toBe(false);
  });

  it("hidas vastaus ylittää maxMs-rajan: varoitus", async () => {
    const r = await run("good-server.mjs", [call("slow", { ms: 300 }, { maxMs: 100 })]);
    expect(r.findings.map((f) => f.id)).toEqual(["SMOKE_SLOW"]);
    expect(r.smoke[0].ok).toBe(true);
  });

  it("aikakatkaisu on virhe SMOKE_CALL_FAILED", async () => {
    const r = await run("good-server.mjs", [call("slow", { ms: 6000 })], 1500);
    expect(r.findings.map((f) => f.id)).toEqual(["SMOKE_CALL_FAILED"]);
    expect(r.ok).toBe(false);
  });

  it("virheellinen argumentti (väärä tyyppi) kirjataan virheenä, ei kaada ajoa", async () => {
    const r = await run("good-server.mjs", [call("add", { a: "yksi", b: 2 }), call("greet", { name: "Tony" })]);
    expect(r.findings.some((f) => f.tool === "add")).toBe(true);
    expect(r.smoke.map((s) => s.ok)).toEqual([false, true]); // seuraava kutsu ajetaan silti
  });

  it("savuajotiedoston tuntematon työkalu on virhe", async () => {
    const r = await run("good-server.mjs", [call("ei_ole")]);
    expect(r.findings.map((f) => f.id)).toEqual(["SMOKE_TOOL_NOT_FOUND"]);
    expect(r.smoke).toEqual([{ tool: "ei_ole", ok: false, ms: 0 }]);
  });
});

describe("diagnose: viallinen palvelin", () => {
  it("huonot työkalumäärittelyt löytyvät", async () => {
    const r = await run("bad-tools-server.mjs");
    const ids = r.findings.map((f) => f.id);
    expect(r.server?.name).toBe("huono-palvelin");
    expect(ids).toContain("TOOL_DUPLICATE");
    expect(ids).toContain("TOOL_NAME_INVALID");
    expect(ids).toContain("TOOL_DESC_MISSING");
    expect(ids).toContain("SCHEMA_PROP_UNTYPED");
    expect(ids).toContain("SCHEMA_REQUIRED_UNKNOWN");
    expect(r.ok).toBe(false);
    expect(r.summary.errors).toBeGreaterThanOrEqual(3);
  });

  it("tuntematon protokollaversio: CONNECT_FAILED, ei kaatumista", async () => {
    const r = await run("wrong-protocol-server.mjs");
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].id).toBe("CONNECT_FAILED");
    expect(r.findings[0].message).toMatch(/1999-01-01|protocol/i);
    expect(r.server).toBeNull();
    expect(r.ok).toBe(false);
  });

  it("heti kaatuva palvelin: yhteysvirhe sisältää palvelimen stderrin", async () => {
    const r = await run("crash-server.mjs");
    expect(r.findings[0].id).toBe("CONNECT_FAILED");
    expect(r.findings[0].message).toContain("asetus puuttuu");
  });

  it("palvelin, jota ei voi käynnistää, on CONNECT_FAILED", async () => {
    const transport = new StdioClientTransport({ command: "tata-komentoa-ei-ole-olemassa", args: [] });
    const r = await diagnose({ transport, target: "x", timeoutMs: 3000, strict: false });
    expect(r.findings[0].id).toBe("CONNECT_FAILED");
  });
});

describe("diagnose: poikkeavat tools/list-tilanteet", () => {
  const variant = (mode: string, smoke?: SmokeCall[]) => {
    const transport = new StdioClientTransport({ command: NODE, args: [fixture("variant-server.mjs"), mode], stderr: "pipe" });
    return diagnose({ transport, target: mode, smoke, timeoutMs: 10000, strict: false });
  };

  it("ei tools-kykyä: varoitus, työkaluja ei listata", async () => {
    const r = await variant("nocaps");
    expect(r.findings.map((f) => f.id)).toEqual(["TOOLS_CAPABILITY_MISSING"]);
    expect(r.ok).toBe(true);
  });

  it("tyhjä työkalulista: varoitus", async () => {
    const r = await variant("empty");
    expect(r.findings.map((f) => f.id)).toEqual(["TOOLS_EMPTY"]);
  });

  it("tools/list epäonnistuu: virhe, ei kaatumista", async () => {
    const r = await variant("listfails");
    expect(r.findings.map((f) => f.id)).toEqual(["TOOLS_LIST_FAILED"]);
    expect(r.findings[0].message).toContain("lista hajosi");
    expect(r.ok).toBe(false);
  });

  it("sivutettu lista luetaan kokonaan", async () => {
    const r = await variant("paged");
    expect(r.toolCount).toBe(2);
    expect(r.findings).toEqual([]);
  });

  it("päättymätön sivutus katkaistaan 50 sivun jälkeen", async () => {
    const r = await variant("infinite");
    expect(r.toolCount).toBe(50);
    expect(r.findings.map((f) => f.id)).toEqual(["TOOLS_PAGINATION_LIMIT"]);
  });

  it("tyhjä palvelimen nimi: varoitus serverInfo:sta", async () => {
    const r = await variant("noname");
    expect(r.findings.map((f) => f.id)).toContain("SERVER_INFO_MISSING");
  });

  it("outputSchema ilman structuredContent-tulosta näkyy virheenä SMOKE_CALL_FAILED", async () => {
    const r = await variant("nooutput", [{ tool: "rakenne", arguments: {}, expectError: false, maxMs: 5000 }]);
    const f = r.findings.find((x) => x.id === "SMOKE_CALL_FAILED");
    expect(f?.message).toMatch(/structured/i);
    expect(r.ok).toBe(false);
  });
});

describe("diagnose: palvelimelta tuleva teksti (turvallisuus)", () => {
  it("rivinvaihdot ja escape-sekvenssit eivät pääse tekstitulosteeseen", async () => {
    const r = await run("hostile-server.mjs");
    const text = formatText(r);
    expect(text.split("\n").some((l) => l.startsWith("::"))).toBe(false);
    expect(text).not.toContain("\x1b");
    expect(text).toContain("paha ::error::vaarennos"); // sisältö säilyy luettavana, rakenne ei
    expect(r.findings.some((f) => f.tool === "a\n::warning::x")).toBe(true); // raakadata säilyy JSONissa
  });
});

describe("diagnose: odotettu virhe protokollatasolla", () => {
  it("JSON-RPC-virhe kelpaa, kun expectError on päällä (huomiona)", async () => {
    const r = await run("protocol-error-server.mjs", [call("strict", {}, { expectError: true })]);
    expect(r.findings.map((f) => f.id)).toEqual(["SMOKE_EXPECTED_PROTOCOL_ERROR"]);
    expect(r.findings[0].severity).toBe("info");
    expect(r.smoke[0].ok).toBe(true);
    expect(r.ok).toBe(true);
  });

  it("JSON-RPC-virhe on virhe, kun expectError ei ole päällä", async () => {
    const r = await run("protocol-error-server.mjs", [call("strict")]);
    expect(r.findings.map((f) => f.id)).toEqual(["SMOKE_CALL_FAILED"]);
    expect(r.smoke[0].ok).toBe(false);
    expect(r.ok).toBe(false);
  });

  it("aikakatkaisu ei kelpaa odotettuna virheenä", async () => {
    const r = await run("good-server.mjs", [call("slow", { ms: 6000 }, { expectError: true })], 1500);
    expect(r.findings.map((f) => f.id)).toEqual(["SMOKE_CALL_FAILED"]);
    expect(r.ok).toBe(false);
  });
});

describe("diagnose: työkalulistaus", () => {
  it("toistuva nextCursor keskeyttää listauksen heti", async () => {
    const r = await run("loop-cursor-server.mjs");
    const ids = r.findings.map((f) => f.id);
    expect(ids).toContain("TOOLS_PAGINATION_LOOP");
    expect(ids).not.toContain("TOOLS_PAGINATION_LIMIT");
  });

  it("ilman tools-kykyä savuajon virhe kertoo, ettei listaa saatu", async () => {
    const r = await run("no-tools-server.mjs", [call("x")]);
    const f = r.findings.find((x) => x.id === "SMOKE_TOOL_NOT_FOUND");
    expect(f?.message).toContain("työkalulistaa ei saatu");
  });
});

describe("diagnose: kokonaisaikaraja (--total-timeout-ms)", () => {
  const runTotal = (smoke: SmokeCall[], totalTimeoutMs: number | undefined, timeoutMs = 10000) => {
    const transport = new StdioClientTransport({ command: NODE, args: [fixture("good-server.mjs")], stderr: "pipe" });
    return diagnose({ transport, target: "good", smoke, timeoutMs, totalTimeoutMs, strict: false });
  };

  it("monta hidasta kutsua: pyyntökohtainen raja ei laukea, kokonaisraja laukeaa ja loput ohitetaan", async () => {
    const t0 = Date.now();
    const smoke = [call("slow", { ms: 1500 }), call("slow", { ms: 1500 }), call("slow", { ms: 1500 }), call("greet", { name: "Tony" })];
    const r = await runTotal(smoke, 2500);
    const ids = r.findings.map((f) => f.id);
    expect(ids).toContain("TOTAL_TIMEOUT");
    expect(ids.filter((x) => x === "TOTAL_TIMEOUT")).toHaveLength(1);
    expect(r.ok).toBe(false);
    // ensimmäinen kutsu onnistuu, toinen katkeaa kokonaisrajaan, loput ohitetaan mutta näkyvät tuloksissa
    expect(r.smoke.map((s) => s.ok)).toEqual([true, false, false, false]);
    expect(r.smoke).toHaveLength(4);
    expect(Date.now() - t0).toBeLessThan(5000);
    const f = r.findings.find((x) => x.id === "TOTAL_TIMEOUT");
    expect(f?.message).toContain("2500 ms");
    expect(f?.severity).toBe("error");
  });

  it("ilman kokonaisrajaa sama savuajo menee läpi (oletus ennallaan)", async () => {
    const r = await runTotal([call("slow", { ms: 300 }), call("slow", { ms: 300 })], undefined);
    expect(r.findings.map((f) => f.id)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("riittävä kokonaisraja ei tuota löydöksiä", async () => {
    const r = await runTotal([call("slow", { ms: 200 }), call("greet", { name: "Tony" })], 8000);
    expect(r.findings.map((f) => f.id)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("kokonaisraja ylittyy jo kättelyssä: CONNECT_FAILED ja TOTAL_TIMEOUT", async () => {
    const r = await runTotal([call("greet", { name: "Tony" })], 1);
    const ids = r.findings.map((f) => f.id);
    expect(ids).toContain("CONNECT_FAILED");
    expect(ids).toContain("TOTAL_TIMEOUT");
    expect(r.ok).toBe(false);
  });
});
