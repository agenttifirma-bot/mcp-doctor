import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = new URL("../src/", import.meta.url);
const opas = readFileSync(new URL("../docs/fixes.md", import.meta.url), "utf8");

describe("docs/fixes.md", () => {
  it("jokaiselle lähdekoodin löydöstunnukselle on oma otsikko", () => {
    const tunnukset = new Set<string>();
    for (const nimi of readdirSync(src).filter((n) => n.endsWith(".ts"))) {
      const teksti = readFileSync(new URL(nimi, src), "utf8");
      for (const m of teksti.matchAll(/"([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)"/g)) tunnukset.add(m[1]);
    }
    expect(tunnukset.size).toBeGreaterThan(30);
    const puuttuu = [...tunnukset].filter((t) => !opas.includes(`### \`${t}\``));
    expect(puuttuu).toEqual([]);
  });
});
