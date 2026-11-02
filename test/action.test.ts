import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// Marketplace-vaatimukset action.yml:lle. Tiedosto luetaan oikealla YAML-jäsentimellä:
// rivipohjainen luku ei huomannut lainaamatonta ": " -yhdistelmää, joka kaatoi CI:n (#18).
// Windowsin git (core.autocrlf) voi muuttaa rivinvaihdot CRLF:ksi: normalisoidaan, jotta testit toimivat kaikkialla.
const lue = (polku: string) => readFileSync(fileURLToPath(new URL(`../${polku}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const yml = lue("action.yml");
const doc = parse(yml) as { name?: unknown; description?: unknown };
const ylataso = (avain: "name" | "description") => (typeof doc[avain] === "string" ? doc[avain] : undefined);

describe("action.yml (GitHub Marketplace)", () => {
  it("nimi ja kuvaus löytyvät, kuvaus alle 125 merkkiä", () => {
    expect(ylataso("name")).toBeTruthy();
    const kuvaus = ylataso("description");
    expect(kuvaus).toBeTruthy();
    expect(kuvaus!.length).toBeLessThan(125);
  });

  it("YAML-jäsennin hylkää lainaamattoman ': ' description-arvossa", () => {
    // Sama vika, joka kaatoi CI:n: ilman lainausmerkkejä toinen kaksoispiste rikkoo YAML:n.
    expect(() => parse("description: Health check for MCP servers: handshake and lint")).toThrow();
    expect(parse('description: "Health check for MCP servers: handshake and lint"')).toEqual({
      description: "Health check for MCP servers: handshake and lint",
    });
  });

  it("action.yml:n description-rivissä ei ole lainaamatonta ': '", () => {
    const rivi = /^description: (.+)$/m.exec(yml)![1]!;
    if (!/^["']/.test(rivi)) expect(rivi).not.toContain(": ");
  });

  it("branding: icon ja color", () => {
    expect(yml).toMatch(/^branding:\n {2}icon: \S+\n {2}color: \S+$/m);
  });

  it("jokaisella syötteellä on kuvaus", () => {
    const lohko = /^inputs:\n([\s\S]*?)^runs:/m.exec(yml)![1]!;
    const nimet = [...lohko.matchAll(/^ {2}([a-z-]+):$/gm)].map((m) => m[1]);
    expect(nimet.length).toBeGreaterThan(0);
    for (const n of nimet) expect(lohko, n).toMatch(new RegExp(`^ {2}${n}:\\n {4}description: .+`, "m"));
  });

  it("runs on composite eikä viittaa paikalliseen polkuun", () => {
    expect(yml).toMatch(/^ {2}using: composite$/m);
    expect(yml).not.toMatch(/uses: \.\.?\//);
  });

  it("README:n, esimerkin ja ohjeiden Action-versio vastaa package.json:ia", () => {
    const v = (JSON.parse(lue("package.json")) as { version: string }).version;
    for (const t of [lue("README.md"), lue("README.fi.md"), lue("examples/workflow.yml"), lue("docs/ci.md"), lue("docs/demo.md")]) {
      expect(t).toContain(`tonyweckstrom1987/mcp-doctor@v${v}`);
    }
  });
});

describe("action.yml: sarif-syöte", () => {
  it("syöte välitetään ympäristömuuttujana ja --sarif-valintana", () => {
    expect(yml).toMatch(/^ {2}sarif:\n {4}description: .+/m);
    expect(yml).toContain("INPUT_SARIF: ${{ inputs.sarif }}");
    expect(yml).toContain('--sarif "$INPUT_SARIF"');
  });

  it("esimerkkityönkulku lataa SARIFin upload-sarif-askeleella myös virheen jälkeen", () => {
    const esim = lue("examples/workflow-sarif.yml");
    const d = parse(esim) as { permissions: Record<string, string>; jobs: { check: { steps: { uses?: string; if?: string; with?: Record<string, string> }[] } } };
    expect(d.permissions["security-events"]).toBe("write");
    const askeleet = d.jobs.check.steps;
    const doctor = askeleet.find((s) => s.uses?.startsWith("tonyweckstrom1987/mcp-doctor@"))!;
    const lataus = askeleet.find((s) => s.uses?.startsWith("github/codeql-action/upload-sarif@"))!;
    expect(doctor.with?.sarif).toBe("mcp-doctor.sarif");
    expect(lataus.with?.sarif_file).toBe("mcp-doctor.sarif");
    expect(lataus.if).toBe("always()");
  });
});
