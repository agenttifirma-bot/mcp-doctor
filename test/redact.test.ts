import { describe, expect, it } from "vitest";
import { maskSecrets, redactArgs } from "../src/redact.js";

describe("redactArgs: salaisuudet peitetään tulostettavasta komennosta", () => {
  it.each([
    [["node", "s.js", "--token", "abc123"], "node s.js --token ***"],
    [["node", "s.js", "--api-key=abc123"], "node s.js --api-key=***"],
    [["node", "s.js", "--apiKey", "abc123"], "node s.js --apiKey ***"],
    [["node", "s.js", "--password", "p4ss", "--port", "3000"], "node s.js --password *** --port 3000"],
    [["node", "s.js", "--client_secret=x"], "node s.js --client_secret=***"],
    [["env", "GITHUB_TOKEN=ghp_abc", "node", "s.js"], "env GITHUB_TOKEN=*** node s.js"],
    [["node", "s.js", "https://user:pw@api.example.com/v1?key=abc"], "node s.js https://***@api.example.com/v1?***"],
    [["node", "s.js", "--db", "postgres://u:p@db:5432/x"], "node s.js --db postgres://***@db:5432/x"],
  ])("%j", (argv, expected) => {
    const joined = redactArgs(argv).join(" ");
    expect(joined).toBe(expected);
    for (const secret of ["abc123", "p4ss", "ghp_abc", "user:pw", "key=abc", "u:p@"]) expect(joined).not.toContain(secret);
  });

  it.each([
    [["node", "server.js"]],
    [["npx", "-y", "@scope/server-memory"]],
    [["node", "s.js", "--port", "3000", "--verbose"]],
    [["node", "s.js", "https://api.example.com/v1"]],
    [["python", "-m", "server", "MODE=dev"]],
  ])("tavalliset argumentit pysyvät ennallaan: %j", (argv) => {
    expect(redactArgs(argv)).toEqual(argv);
  });

  it("salaisen lipun jälkeinen arvo peitetään, vaikka se olisi viimeinen argumentti -- ei kaadu", () => {
    expect(redactArgs(["node", "s.js", "--token"])).toEqual(["node", "s.js", "--token"]);
  });

  it("ei muuta syötetaulukkoa (palvelin käynnistetään alkuperäisillä argumenteilla)", () => {
    const argv = ["node", "s.js", "--token", "abc"];
    redactArgs(argv);
    expect(argv).toEqual(["node", "s.js", "--token", "abc"]);
  });
});

describe("maskSecrets: tunnetut arvot peitetään valmiista tulosteesta", () => {
  const S = "sk-testi-1234567890";

  it("raaka ja JSON-muoto peitetään, lyhyet arvot jätetään", () => {
    expect(maskSecrets(`avain ${S} hylätty`, [S])).toBe("avain *** hylätty");
    const q = 'pa"ss\\word99';
    expect(maskSecrets(JSON.stringify({ m: `x ${q} y` }), [q])).toBe('{"m":"x *** y"}');
    expect(maskSecrets("tila true", ["true"])).toBe("tila true");
  });

  it("300 merkin lyhennys ei jätä arvon alkuosaa näkyviin", () => {
    expect(maskSecrets(`virhe ${S.slice(0, 10)}…`, [S])).toBe("virhe ***…");
    expect(maskSecrets("abc…", [S])).toBe("abc…");
  });

  it("pidempi arvo peitetään ennen lyhyempää, joka on sen osa", () => {
    expect(maskSecrets("A-salainen-12345-B", ["salainen", "A-salainen-12345-B"])).toBe("***");
  });
});
