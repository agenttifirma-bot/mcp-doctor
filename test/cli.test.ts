import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { NODE, fixture, makeIo } from "./helpers.js";

const good = ["--", NODE, fixture("good-server.mjs")];

describe("CLI: ohje ja käyttövirheet (exit 2)", () => {
  it("--help tulostaa ohjeen ja palauttaa 0", async () => {
    const io = makeIo();
    expect(await main(["--help"], io)).toBe(0);
    expect(io.out).toContain("Käyttö:");
  });

  it.each([
    ["tuntematon valinta", ["--outo", "--", "x"]],
    ["ylimääräinen argumentti ilman --", ["foo"]],
    ["ei palvelinta", ["--json"]],
    ["sekä --url että komento", ["--url", "http://localhost:1/mcp", "--", "x"]],
    ["valinta ilman arvoa", ["--smoke"]],
    ["virheellinen aikakatkaisu", ["--timeout-ms", "abc", "--", "x"]],
    ["nolla aikakatkaisu", ["--timeout-ms", "0", "--", "x"]],
    ["virheellinen url", ["--url", "ei-osoite"]],
    ["ftp-osoite", ["--url", "ftp://example.com/x"]],
    ["--env url:n kanssa", ["--url", "http://localhost:1/mcp", "--env", "X"]],
    ["--bearer-env stdion kanssa", ["--bearer-env", "X", "--", "x"]],
    ["--bearer-env tyhjä muuttuja", ["--url", "http://localhost:1/mcp", "--bearer-env", "EI_ASETETTU"]],
    ["--env-muuttujaa ei ole", ["--env", "EI_ASETETTU_X", "--", "x"]],
    ["savuajotiedostoa ei löydy", ["--smoke", "puuttuu.json", "--", "x"]],
    ["savuajotiedosto rikki", ["--smoke", "rikki.json", "--", "x"]],
    ["--smoke kahdesti", ["--smoke", "a", "--smoke", "b", "--", "x"]],
  ] as const)("%s", async (_nimi, argv) => {
    const io = makeIo({}, { "rikki.json": "{" });
    delete io.env.EI_ASETETTU;
    delete io.env.EI_ASETETTU_X;
    expect(await main([...argv], io)).toBe(2);
    expect(io.err).toContain("Virhe:");
  });
});

describe("CLI: ilman argumentteja", () => {
  it("tulostaa ohjeen stderriin ja palauttaa 2", async () => {
    const io = makeIo();
    expect(await main([], io)).toBe(2);
    expect(io.err).toContain("Käyttö:");
    expect(io.out).toBe("");
  });
});

describe("CLI: stdio-palvelin", () => {
  it("kunnossa oleva palvelin: exit 0 ja tekstiraportti", async () => {
    const io = makeIo();
    expect(await main(good, io)).toBe(0);
    expect(io.out).toContain("Palvelin: hyva-palvelin 1.2.3, 5 työkalua");
    expect(io.out).toContain("-> OK");
  });

  it("viallinen palvelin: exit 1 ja löydökset tulosteessa", async () => {
    const io = makeIo();
    expect(await main(["--", NODE, fixture("bad-tools-server.mjs")], io)).toBe(1);
    expect(io.out).toContain("[TOOL_DUPLICATE]");
    expect(io.out).toContain("EPÄONNISTUI");
  });

  it("--json tulostaa jäsennettävän raportin", async () => {
    const io = makeIo();
    expect(await main(["--json", ...good], io)).toBe(0);
    const r = JSON.parse(io.out);
    expect(r.version).toBe(1);
    expect(r.ok).toBe(true);
    expect(r.server.name).toBe("hyva-palvelin");
    expect(r.toolCount).toBe(5);
  });

  it("--smoke ajaa tiedostossa nimetyt kutsut", async () => {
    const spec = JSON.stringify({ calls: [{ tool: "greet", arguments: { name: "Tony" } }, { tool: "always_fails", expectError: true }] });
    const io = makeIo({}, { "savu.json": spec });
    expect(await main(["--smoke", "savu.json", ...good], io)).toBe(0);
    expect(io.out).toMatch(/OK\s+greet \(\d+ ms\)/);
    expect(io.out).toMatch(/OK\s+always_fails/);
  });

  it("--smoke: epäonnistunut kutsu antaa exit 1", async () => {
    const io = makeIo({}, { "savu.json": JSON.stringify([{ tool: "always_fails" }]) });
    expect(await main(["--smoke", "savu.json", ...good], io)).toBe(1);
    expect(io.out).toContain("SMOKE_TOOL_ERROR");
  });

  it("--strict: varoitus kaataa ajon, ilman sitä ei", async () => {
    const files = { "savu.json": JSON.stringify([{ tool: "empty_result" }]) };
    expect(await main(["--smoke", "savu.json", ...good], makeIo({}, files))).toBe(0);
    expect(await main(["--strict", "--smoke", "savu.json", ...good], makeIo({}, files))).toBe(1);
  });

  it("palvelin ei näe vanhempaa ympäristöä, ellei sitä välitetä --env:llä", async () => {
    const probe = fixture("env-probe-server.mjs");
    const io = makeIo({ SALAINEN_ARVO: "ei-saa-nakya", VALITETTU: "nakyy" });
    expect(await main(["--env", "VALITETTU", "--smoke", "e.json", "--", NODE, probe], { ...io, readFile: () => JSON.stringify([{ tool: "env", arguments: { name: "SALAINEN_ARVO" } }, { tool: "env", arguments: { name: "VALITETTU" } }]) })).toBe(0);
    expect(io.out).toContain("OK");
  });

  it("--env-arvo ei vuoda raporttiin, vaikka palvelin tulostaa sen stderriin", async () => {
    const leak = fixture("leak-server.mjs");
    const secret = "sk-testi-1234567890abcdef";
    for (const json of [false, true]) {
      const io = makeIo({ API_TOKEN: secret });
      expect(await main([...(json ? ["--json"] : []), "--env", "API_TOKEN", "--", NODE, leak], io)).toBe(1);
      expect(io.out).toContain("CONNECT_FAILED");
      expect(io.out).toContain("virheellinen avain: ***");
      expect(io.out).not.toContain(secret);
      expect(io.out).not.toContain(secret.slice(0, 8));
    }
  });

  it("aikakatkaisu --timeout-ms:llä", async () => {
    const io = makeIo({}, { "s.json": JSON.stringify([{ tool: "slow", arguments: { ms: 6000 } }]) });
    expect(await main(["--timeout-ms", "1500", "--smoke", "s.json", ...good], io)).toBe(1);
    expect(io.out).toContain("SMOKE_CALL_FAILED");
  });

  it("--total-timeout-ms katkaisee monen kutsun savuajon", async () => {
    const io = makeIo({}, { "s.json": JSON.stringify([{ tool: "slow", arguments: { ms: 1500 } }, { tool: "slow", arguments: { ms: 1500 } }, { tool: "slow", arguments: { ms: 1500 } }]) });
    expect(await main(["--total-timeout-ms", "2000", "--smoke", "s.json", ...good], io)).toBe(1);
    expect(io.out).toContain("TOTAL_TIMEOUT");
  });

  it.each([["0"], ["-5"], ["1.5"], ["abc"]])("--total-timeout-ms %s on käyttövirhe", async (v) => {
    const io = makeIo();
    expect(await main(["--total-timeout-ms", v, ...good], io)).toBe(2);
    expect(io.err).toContain("--total-timeout-ms");
  });
});

describe("CLI: HTTP-palvelin", () => {
  let http: Server;
  let url: string;
  const TOKEN = "testitoken-1234567890";

  beforeAll(async () => {
    http = createServer(async (req, res) => {
      if (req.headers.authorization !== `Bearer ${TOKEN}`) {
        res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      const server = new McpServer({ name: "http-palvelin", version: "9.9.9" });
      server.registerTool("ping", { description: "Vastaa pongilla testejä varten.", inputSchema: { n: z.number().optional().describe("Mikä tahansa luku") } }, async () => ({
        content: [{ type: "text", text: "pong" }],
      }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => void transport.close());
      await server.connect(transport);
      await transport.handleRequest(req, res);
    });
    await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
  });

  afterAll(() => new Promise<void>((r) => http.close(() => r())));

  it("oikea token: exit 0, savuajo toimii", async () => {
    const io = makeIo({ DOCTOR_TOKEN: TOKEN }, { "s.json": JSON.stringify([{ tool: "ping" }]) });
    expect(await main(["--url", url, "--bearer-env", "DOCTOR_TOKEN", "--smoke", "s.json"], io)).toBe(0);
    expect(io.out).toContain("Palvelin: http-palvelin 9.9.9, 1 työkalua");
    expect(io.out).toMatch(/OK\s+ping/);
    expect(io.err).not.toContain("salaamattomana"); // localhost: ei varoitusta
  });

  it("token salaamattomalla http-yhteydellä muualle kuin localhostiin: varoitus", async () => {
    const io = makeIo({ DOCTOR_TOKEN: TOKEN });
    await main(["--url", "http://palvelin.invalid/mcp", "--bearer-env", "DOCTOR_TOKEN", "--timeout-ms", "1000"], io);
    expect(io.err).toContain("salaamattomana");
    expect(io.err).not.toContain(TOKEN);
  });

  it("väärä token: yhteysvirhe (exit 1), tokenia ei tulosteta", async () => {
    const io = makeIo({ DOCTOR_TOKEN: "vaara-token-xxxxxxxxxx" });
    expect(await main(["--url", url, "--bearer-env", "DOCTOR_TOKEN"], io)).toBe(1);
    expect(io.out).toContain("CONNECT_FAILED");
    expect(io.out + io.err).not.toContain("vaara-token-xxxxxxxxxx");
  });

  it("ei tokenia: yhteysvirhe (exit 1)", async () => {
    const io = makeIo();
    expect(await main(["--url", url], io)).toBe(1);
    expect(io.out).toContain("CONNECT_FAILED");
  });

  it("--auth: 401 ilman WWW-Authenticatea ja metatietoja raportoidaan, tokenia ei lähetetä tarkistuksessa", async () => {
    const io = makeIo({ DOCTOR_TOKEN: TOKEN });
    expect(await main(["--url", url, "--auth", "--bearer-env", "DOCTOR_TOKEN", "--json"], io)).toBe(1);
    const r = JSON.parse(io.out);
    const ids = r.findings.map((f: { id: string }) => f.id);
    expect(ids).toContain("AUTH_WWW_AUTHENTICATE_MISSING");
    expect(ids).toContain("AUTH_RESOURCE_METADATA_MISSING");
    expect(r.server.name).toBe("http-palvelin"); // varsinainen tarkastus ajetaan silti tokenilla
  });

  it("kohde tulostuu ilman kyselyparametreja ja tunnuksia", async () => {
    const io = makeIo({ DOCTOR_TOKEN: TOKEN });
    await main(["--url", `${url}?salainen=abc`, "--bearer-env", "DOCTOR_TOKEN"], io);
    expect(io.out).not.toContain("salainen");
  });
});

describe("CLI: --auth ilman tokenia", () => {
  let http: Server;
  let base: string;

  beforeAll(async () => {
    http = createServer((req, res) => {
      const json = (o: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(o));
      if (req.url === "/.well-known/oauth-protected-resource/mcp") return json({ resource: `${base}/mcp`, authorization_servers: [base] });
      if (req.url === "/.well-known/oauth-authorization-server") {
        return json({
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          code_challenge_methods_supported: ["S256"],
          grant_types_supported: ["authorization_code", "refresh_token"],
        });
      }
      res.writeHead(401, { "content-type": "application/json", "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` }).end("{}");
    });
    await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((r) => http.close(() => r())));

  it("kunnossa oleva OAuth-palvelin: kirjautumisvaatimus ei ole virhe (exit 0, ei CONNECT_FAILED)", async () => {
    const io = makeIo();
    expect(await main(["--url", `${base}/mcp`, "--auth", "--json"], io)).toBe(0);
    const ids = JSON.parse(io.out).findings.map((f: { id: string }) => f.id);
    expect(ids).toContain("AUTH_OK");
    expect(ids).toContain("AUTH_LOGIN_REQUIRED");
    expect(ids).not.toContain("CONNECT_FAILED");
  });

  it("tokenin kanssa CONNECT_FAILED säilyy virheenä (väärä token ei peity)", async () => {
    const io = makeIo({ DOCTOR_TOKEN: "vaara-token-xxxxxxxxxx" });
    expect(await main(["--url", `${base}/mcp`, "--auth", "--bearer-env", "DOCTOR_TOKEN", "--json"], io)).toBe(1);
    const ids = JSON.parse(io.out).findings.map((f: { id: string }) => f.id);
    expect(ids).toContain("CONNECT_FAILED");
    expect(ids).not.toContain("AUTH_LOGIN_REQUIRED");
  });
});

describe("CLI: stdio-kohde ei vuoda salaisuuksia", () => {
  it("komentorivin token ei näy teksti- eikä JSON-raportissa, mutta palvelin saa sen", async () => {
    const argv = ["--", NODE, fixture("good-server.mjs"), "--token", "SALAINEN_ARVO_42"];
    const io = makeIo();
    expect(await main(argv, io)).toBe(0);
    expect(io.out).toContain("--token ***");
    expect(io.out).not.toContain("SALAINEN_ARVO_42");
    const json = makeIo();
    await main(["--json", ...argv], json);
    expect(json.out).not.toContain("SALAINEN_ARVO_42");
  });
});

describe("CLI: odottamaton virhe (exit 3)", () => {
  it("sisäinen virhe palauttaa 3, ei käyttövirheen koodia 2", async () => {
    const io = makeIo();
    io.stdout = () => {
      throw new Error("rikki");
    };
    expect(await main(good, io)).toBe(3);
    expect(io.err).toContain("Odottamaton virhe: rikki");
  });

  it("virheviestin ohjausmerkit siivotaan (ei uutta riviä esim. ::warning::-komennolle)", async () => {
    const io = makeIo();
    io.stdout = () => {
      throw new Error("rikki\n::warning::huijaus\u001b[31m");
    };
    expect(await main(good, io)).toBe(3);
    expect(io.err).toBe("Odottamaton virhe: rikki ::warning::huijaus [31m\n");
  });
});
