import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { summarize } from "../src/report.js";
import { RULES, formatSarif } from "../src/sarif.js";
import type { Finding, Report } from "../src/types.js";
import { NODE, fixture, makeIo } from "./helpers.js";

const skeema = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/sarif-schema-2.1.0.json", import.meta.url)), "utf8"));
const ajv = new Ajv({ strict: false, allErrors: true });
// Formaatit (uri, uri-reference, date-time) tarkistetaan oikeasti: pelkkä rakenne ei riitä.
(addFormats as unknown as (a: Ajv) => void)(ajv);
const validate = ajv.compile(skeema);
const kelvollinen = (teksti: string) => {
  const ok = validate(JSON.parse(teksti));
  expect(ok, JSON.stringify(validate.errors)).toBe(true);
};

function raportti(findings: Finding[], target = "node dist/index.js"): Report {
  const summary = summarize(findings);
  return { version: 1, target, server: null, toolCount: 0, findings, smoke: [], summary, ok: summary.errors === 0 };
}

describe("SARIF-muoto", () => {
  it("tyhjä löydöslista tuottaa kelvollisen SARIFin", () => {
    const teksti = formatSarif(raportti([]));
    kelvollinen(teksti);
    const s = JSON.parse(teksti);
    expect(s.version).toBe("2.1.0");
    expect(s.runs[0].results).toEqual([]);
    expect(s.runs[0].tool.driver.rules.length).toBeGreaterThan(40);
  });

  it("vakavuudet kuvautuvat tasoiksi ja sijainti on kohde", () => {
    const teksti = formatSarif(raportti([
      { id: "TOOL_DUPLICATE", severity: "error", message: "kaksi samaa", tool: "haku" },
      { id: "TOOL_DESC_MISSING", severity: "warning", message: "ei kuvausta", tool: "haku" },
      { id: "TOOL_DESC_SHORT", severity: "info", message: "lyhyt" },
    ]));
    kelvollinen(teksti);
    const { results, tool } = JSON.parse(teksti).runs[0];
    expect(results.map((r: { level: string }) => r.level)).toEqual(["error", "warning", "note"]);
    expect(results[0].ruleId).toBe("TOOL_DUPLICATE");
    expect(tool.driver.rules[results[0].ruleIndex].id).toBe("TOOL_DUPLICATE");
    expect(results[0].message.text).toBe("haku: kaksi samaa");
    // Välilyönnit koodataan, jotta artifactLocation.uri on kelvollinen URI-viite.
    expect(results[0].locations[0].physicalLocation.artifactLocation.uri).toBe("node%20dist/index.js");
  });

  it("URL-kohteen kyselymerkit koodataan", () => {
    const s = JSON.parse(formatSarif(raportti([{ id: "TOOLS_EMPTY", severity: "warning", message: "x" }], "https://e.fi/mcp")));
    expect(s.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri).toBe("https://e.fi/mcp");
  });

  it("jokaisella tunnetulla koodilla on sääntö, eikä sääntöjä ole kahta samaa", () => {
    const idt = RULES.map((r) => r.id);
    expect(new Set(idt).size).toBe(idt.length);
    for (const r of RULES) expect(r.text.length).toBeGreaterThan(5);
  });

  it("jokainen lähdekoodin löydöskoodi on sääntötaulukossa", () => {
    const hakemisto = new URL("../src/", import.meta.url);
    const koodit = new Set<string>();
    for (const nimi of readdirSync(hakemisto)) {
      if (!nimi.endsWith(".ts") || nimi === "sarif.ts") continue;
      for (const m of readFileSync(new URL(nimi, hakemisto), "utf8").matchAll(/"([A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+)"/g)) koodit.add(m[1]);
    }
    expect(koodit.size).toBeGreaterThan(40);
    const idt = new Set(RULES.map((r) => r.id));
    expect([...koodit].filter((k) => !idt.has(k))).toEqual([]);
  });

  it("tuntematon koodi saa oman säännön ja ruleIndex täsmää", () => {
    const teksti = formatSarif(raportti([{ id: "UUSI_KOODI", severity: "warning", message: "x" }]));
    kelvollinen(teksti);
    const { results, tool } = JSON.parse(teksti).runs[0];
    expect(tool.driver.rules[results[0].ruleIndex].id).toBe("UUSI_KOODI");
  });

  it("palvelimelta tuleva teksti on siivottu (rivinvaihdot, ohjausmerkit, pituus)", () => {
    const hurja = "paha\n::error::injektio\u001b[31m" + "x".repeat(500);
    const teksti = formatSarif(raportti([{ id: "TOOL_DUPLICATE", severity: "error", message: hurja, tool: "työkalu\nnimi" }], "node \nserver.js\u0007"));
    kelvollinen(teksti);
    const r = JSON.parse(teksti).runs[0].results[0];
    expect(r.message.text).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(r.message.text.length).toBeLessThan(700);
    expect(r.locations[0].logicalLocations[0].name).toBe("työkalu nimi");
    expect(r.locations[0].physicalLocation.artifactLocation.uri).toBe("node%20server.js");
    expect(teksti).not.toMatch(/\\u001b|\\u0007/);
  });
});

describe("CLI: --sarif", () => {
  it("kirjoittaa kelvollisen SARIFin oikeasta ajosta ja palauttaa silti oman exit-koodinsa", async () => {
    const io = makeIo();
    const koodi = await main(["--sarif", "ulos.sarif", "--", NODE, fixture("bad-tools-server.mjs")], io);
    expect(koodi).toBe(1);
    kelvollinen(io.written["ulos.sarif"]);
    expect(JSON.parse(io.written["ulos.sarif"]).runs[0].results.length).toBeGreaterThan(0);
  });

  it("kunnossa oleva palvelin: tyhjä tulosjoukko ja exit 0", async () => {
    const io = makeIo();
    expect(await main(["--sarif", "ulos.sarif", "--", NODE, fixture("good-server.mjs")], io)).toBe(0);
    kelvollinen(io.written["ulos.sarif"]);
  });

  it("kirjoitusvirhe on käyttövirhe (exit 2), eikä poikkeuksen viestiä tulosteta", async () => {
    const io = makeIo();
    io.writeFile = () => {
      throw new Error("EACCES salainen-polku");
    };
    expect(await main(["--sarif", "/ei/saa/kirjoittaa", "--", NODE, fixture("good-server.mjs")], io)).toBe(2);
    expect(io.err).toContain("ei voi kirjoittaa");
    expect(io.err).not.toContain("salainen-polku");
  });

  it("valinta ilman arvoa ja kahdesti ovat käyttövirheitä", async () => {
    expect(await main(["--sarif"], makeIo())).toBe(2);
    expect(await main(["--sarif", "a", "--sarif", "b", "--", NODE, fixture("good-server.mjs")], makeIo())).toBe(2);
  });
});
