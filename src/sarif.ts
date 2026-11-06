import { clean, short } from "./text.js";
import type { Finding, Report, Severity } from "./types.js";
import { VERSIO } from "./versio.js";

/** SARIF-skeeman osoite, jonka GitHub code scanning hyväksyy. */
export const SARIF_SCHEMA = "https://json.schemastore.org/sarif-2.1.0.json";
const INFO_URI = "https://github.com/tonyweckstrom1987/mcp-doctor";

export type SarifLevel = "error" | "warning" | "note";

const LEVEL: Record<Severity, SarifLevel> = { error: "error", warning: "warning", info: "note" };

/** Kaikki löydöskoodit kuvauksineen (SARIFin tool.driver.rules). Taulukkoa vartioi testi: jokaisella koodilla pitää olla rivi. */
export const RULES: readonly { id: string; severity: Severity; text: string }[] = [
  { id: "CONNECT_FAILED", severity: "error", text: "Connection or initialize handshake failed." },
  { id: "SERVER_INFO_MISSING", severity: "warning", text: "The server does not report its name and version." },
  { id: "TOOLS_CAPABILITY_MISSING", severity: "warning", text: "The server does not declare the tools capability." },
  { id: "TOOLS_LIST_FAILED", severity: "error", text: "tools/list failed." },
  { id: "TOOLS_EMPTY", severity: "warning", text: "Tools capability declared, but the tool list is empty." },
  { id: "TOOLS_PAGINATION_LIMIT", severity: "warning", text: "Tool listing continued past the page limit and was stopped." },
  { id: "TOOLS_PAGINATION_LOOP", severity: "warning", text: "The server returned the same nextCursor again, listing was stopped." },
  { id: "TOOL_DUPLICATE", severity: "error", text: "The same tool name appears more than once." },
  { id: "TOOL_NAME_INVALID", severity: "error", text: "Tool name is empty, too long or has characters outside A-Z a-z 0-9 _ - ." },
  { id: "TOOL_NAME_PORTABILITY", severity: "warning", text: "Tool name does not match [A-Za-z0-9_-]{1,64}, which some clients require." },
  { id: "TOOL_DESC_MISSING", severity: "warning", text: "Tool description is missing." },
  { id: "TOOL_DESC_SHORT", severity: "info", text: "Tool description is very short." },
  { id: "SCHEMA_NOT_OBJECT", severity: "error", text: "Input schema is missing or its type is not object." },
  { id: "SCHEMA_REQUIRED_INVALID", severity: "error", text: "required is not a list of strings." },
  { id: "SCHEMA_REQUIRED_UNKNOWN", severity: "error", text: "required names a property that does not exist." },
  { id: "SCHEMA_PROP_DESC_MISSING", severity: "warning", text: "A property has no description." },
  { id: "SCHEMA_PROP_UNTYPED", severity: "warning", text: "A property has no type, enum, const, $ref or anyOf/oneOf/allOf." },
  { id: "SCHEMA_ARRAY_ITEMS_MISSING", severity: "warning", text: "An array property has no items." },
  { id: "SCHEMA_NESTED_DESC_MISSING", severity: "info", text: "A nested property has no description." },
  { id: "SCHEMA_NESTED_PROP_UNTYPED", severity: "info", text: "A nested property has no type." },
  { id: "OUTPUT_SCHEMA_NOT_OBJECT", severity: "error", text: "outputSchema is not an object schema." },
  { id: "TOOL_TOKENS_HIGH", severity: "info", text: "A single tool definition costs an estimated more than 1000 tokens." },
  { id: "TOOLS_TOKEN_BUDGET_EXCEEDED", severity: "error", text: "The estimated total size of the tool definitions exceeds --max-tokens." },
  { id: "SMOKE_TOOL_NOT_FOUND", severity: "error", text: "The smoke file names a tool the server does not have." },
  { id: "SMOKE_TOOL_ERROR", severity: "error", text: "A smoke call returned isError although no error was expected." },
  { id: "SMOKE_EXPECTED_ERROR", severity: "error", text: "An expected error did not occur in a smoke call." },
  { id: "SMOKE_EXPECTED_PROTOCOL_ERROR", severity: "info", text: "The expected error came as a JSON-RPC error, not as an isError result." },
  { id: "SMOKE_CALL_FAILED", severity: "error", text: "A smoke call failed (timeout, protocol error or outputSchema violation)." },
  { id: "SMOKE_EMPTY_RESULT", severity: "warning", text: "A smoke call returned an empty result." },
  { id: "SMOKE_SLOW", severity: "warning", text: "A smoke call took longer than maxMs." },
  { id: "AUTH_CHECK_FAILED", severity: "error", text: "The unauthenticated initialize request failed." },
  { id: "AUTH_LOGIN_REQUIRED", severity: "info", text: "The server requires login, so the full check could not run without a token." },
  { id: "AUTH_NOT_REQUIRED", severity: "info", text: "The server does not require login; the OAuth check was skipped." },
  { id: "AUTH_FORBIDDEN", severity: "info", text: "The server refused the unauthenticated request with 403 and gave no OAuth challenge; the OAuth check was skipped." },
  { id: "AUTH_OK", severity: "info", text: "OAuth metadata is in order." },
  { id: "AUTH_WWW_AUTHENTICATE_MISSING", severity: "warning", text: "The 401 response has no WWW-Authenticate: Bearer header." },
  { id: "AUTH_RESOURCE_METADATA_HINT_MISSING", severity: "info", text: "WWW-Authenticate has no resource_metadata parameter." },
  { id: "AUTH_RESOURCE_METADATA_MISSING", severity: "error", text: "Protected resource metadata (RFC 9728) was not found." },
  { id: "AUTH_RESOURCE_INVALID", severity: "error", text: "Protected resource metadata has no resource field." },
  { id: "AUTH_RESOURCE_MISMATCH", severity: "warning", text: "Metadata resource does not match the server address." },
  { id: "AUTH_SERVERS_MISSING", severity: "error", text: "Metadata has no authorization_servers." },
  { id: "AUTH_SERVER_METADATA_MISSING", severity: "error", text: "Authorization server metadata (RFC 8414 / OpenID) was not found." },
  { id: "AUTH_ENDPOINT_MISSING", severity: "error", text: "Authorization server metadata lacks a required endpoint." },
  { id: "AUTH_INSECURE_URL", severity: "error", text: "An OAuth address is not https." },
  { id: "AUTH_PKCE_S256_MISSING", severity: "error", text: "PKCE S256 is not supported." },
  { id: "AUTH_REFRESH_TOKEN_UNSUPPORTED", severity: "warning", text: "The refresh_token grant is not supported." },
  { id: "AUTH_REGISTRATION_UNSUPPORTED", severity: "info", text: "No client registration endpoint or client ID metadata document support." },
];

/** Kohteen URI-muoto. Kaikki palvelimelta tuleva teksti siivotaan (clean/short), koska SARIF päätyy GitHubin käyttöliittymään. */
function sarifUri(target: string): string {
  // Kohde on komento tai URL, ei tiedosto: välilyönnit ja muut merkit koodataan, jotta arvo on kelvollinen URI-viite.
  return encodeURI(clean(target)).replace(/#/g, "%23").replace(/\?/g, "%3F") || "unknown";
}

export function formatSarif(r: Report): string {
  const rules: { id: string; shortDescription: { text: string }; defaultConfiguration: { level: SarifLevel }; helpUri: string }[] = RULES.map((x) => ({
    id: x.id,
    shortDescription: { text: x.text },
    defaultConfiguration: { level: LEVEL[x.severity] },
    helpUri: `${INFO_URI}#what-it-checks`,
  }));
  const index = new Map(rules.map((x, i) => [x.id, i]));
  const uri = sarifUri(r.target);
  const results = r.findings.map((f: Finding) => {
    let i = index.get(f.id);
    if (i === undefined) {
      // Tuntematon koodi (esim. uusi löydös ilman taulukkoriviä): lisätään sääntö, jotta ruleIndex osoittaa aina johonkin.
      const id = clean(f.id) || "UNKNOWN";
      rules.push({ id, shortDescription: { text: id }, defaultConfiguration: { level: LEVEL[f.severity] }, helpUri: `${INFO_URI}#what-it-checks` });
      i = rules.length - 1;
      index.set(f.id, i);
    }
    return {
      ruleId: rules[i].id,
      ruleIndex: i,
      level: LEVEL[f.severity],
      message: { text: f.tool ? `${short(f.tool)}: ${short(f.message)}` : short(f.message) },
      locations: [
        {
          physicalLocation: { artifactLocation: { uri }, region: { startLine: 1 } },
          ...(f.tool ? { logicalLocations: [{ name: short(f.tool), kind: "function" }] } : {}),
        },
      ],
    };
  });
  const sarif = {
    $schema: SARIF_SCHEMA,
    version: "2.1.0",
    runs: [{ tool: { driver: { name: "mcp-doctor", version: VERSIO, informationUri: INFO_URI, rules } }, results }],
  };
  return JSON.stringify(sarif, null, 2) + "\n";
}
