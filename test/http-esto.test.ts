import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { makeIo } from "./helpers.js";

// Paikallinen palvelin, joka torjuu kaikki pyynnöt: /403 -> 403, /401 -> 401, /500 -> 500. Ei ulkoisia kutsuja.
let http: Server;
let base = "";

beforeAll(async () => {
  http = createServer((req, res) => {
    req.resume();
    const status = Number((req.url ?? "").split("/")[1]) || 500;
    if ((req.url ?? "").startsWith("/html403")) {
      // Bottisuojan tyyppinen vastaus: 403 ja HTML-sivu.
      res.writeHead(403, { "content-type": "text/html; charset=utf-8" });
      res.end("<!DOCTYPE html><html><head><title>Access denied</title></head><body><h1>403 Forbidden</h1><p>Bot protection blocked this request.</p></body></html>");
      return;
    }
    res.writeHead(status, { "content-type": "text/plain", ...(status === 401 ? { "www-authenticate": 'Bearer realm="x"' } : {}) });
    res.end("denied");
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});
afterAll(() => void http.close());

describe("palvelin estää pyynnön (401/403)", () => {
  it("403: yhteysvirhe nimeää tilan ja antaa vihjeen (--bearer-env, --auth)", async () => {
    const io = makeIo();
    expect(await main(["--url", `${base}/403`, "--timeout-ms", "3000"], io)).toBe(1);
    expect(io.out).toContain("CONNECT_FAILED");
    expect(io.out).toContain("HTTP 403");
    expect(io.out).toContain("--bearer-env");
    expect(io.out).toContain("--auth");
  });

  it("401: yhteysvirhe nimeää tilan ja kehottaa antamaan tokenin tai ajamaan --auth", async () => {
    const io = makeIo();
    expect(await main(["--url", `${base}/401`, "--timeout-ms", "3000"], io)).toBe(1);
    expect(io.out).toContain("HTTP 401");
    expect(io.out).toContain("palvelin vaatii kirjautumisen");
    expect(io.out).toContain("--auth");
  });

  it("muu virhetila (500) ei saa estovihjettä", async () => {
    const io = makeIo();
    expect(await main(["--url", `${base}/500`, "--timeout-ms", "3000"], io)).toBe(1);
    expect(io.out).toContain("CONNECT_FAILED");
    expect(io.out).not.toContain("HTTP 500:");
    expect(io.out).not.toContain("vaatii kirjautumisen");
  });

  it("--auth + 403: ei väitä, ettei kirjautumista vaadita", async () => {
    const io = makeIo();
    expect(await main(["--url", `${base}/403`, "--auth", "--timeout-ms", "3000", "--json"], io)).toBe(1);
    const ids = (JSON.parse(io.out).findings as { id: string }[]).map((x) => x.id);
    expect(ids).toContain("AUTH_FORBIDDEN");
    expect(ids).toContain("CONNECT_FAILED");
    expect(ids).not.toContain("AUTH_NOT_REQUIRED");
    expect(ids).not.toContain("AUTH_LOGIN_REQUIRED");
  });

  it("--auth + 401: kirjautuminen vaaditaan -tieto säilyy", async () => {
    const io = makeIo();
    await main(["--url", `${base}/401`, "--auth", "--timeout-ms", "3000", "--json"], io);
    const ids = (JSON.parse(io.out).findings as { id: string }[]).map((x) => x.id);
    expect(ids).toContain("AUTH_LOGIN_REQUIRED");
  });

  it("403 + HTML-runko (Content-Type: text/html): yhteysvirhe nimeää tilan ja antaa vihjeen", async () => {
    const io = makeIo();
    expect(await main(["--url", `${base}/html403`, "--timeout-ms", "3000"], io)).toBe(1);
    expect(io.out).toContain("CONNECT_FAILED");
    expect(io.out).toContain("HTTP 403");
    expect(io.out).toContain("--bearer-env");
    expect(io.out).toContain("--auth");
  });

  it("--auth + 403 + HTML-runko: AUTH_FORBIDDEN eikä AUTH_NOT_REQUIRED", async () => {
    const io = makeIo();
    expect(await main(["--url", `${base}/html403`, "--auth", "--timeout-ms", "3000", "--json"], io)).toBe(1);
    const ids = (JSON.parse(io.out).findings as { id: string }[]).map((x) => x.id);
    expect(ids).toContain("AUTH_FORBIDDEN");
    expect(ids).toContain("CONNECT_FAILED");
    expect(ids).not.toContain("AUTH_NOT_REQUIRED");
  });
});
