# Fix guide: one finding at a time

Every finding mcp-doctor prints has a code in square brackets, for example `[SCHEMA_PROP_DESC_MISSING]`. This guide explains each code: what it means, why an MCP client cares, a before/after example, and how to check the fix. The code list with severities is in the [README](../README.md#what-it-checks).

How to re-check any fix:

```bash
npm run build   # your own server
npx @tonyweckstrom/mcp-doctor --strict -- node dist/index.js
```

The finding disappears from the output and the last line says `-> OK`. Add `--smoke smoke.json` for the `SMOKE_*` codes and `--auth --url <url>` for the `AUTH_*` codes.

**About the examples.** Each example was run against mcp-doctor 0.5.0 with a small test server. The report text is Finnish at the moment, so the quoted output is Finnish too. The codes, severities and exit codes are what you should rely on. Where an example could not be reproduced end to end, the section says **Not verified**.

Severity decides the exit code: `error` always fails the run (exit 1), `warning` fails it only with `--strict`, `info` never does.

Contents: [Connection and server](#connection-and-server) · [Tool list](#tool-list) · [Tool names and descriptions](#tool-names-and-descriptions) · [Input and output schemas](#input-and-output-schemas) · [Token size](#token-size) · [Smoke calls](#smoke-calls) · [OAuth (`--auth`)](#oauth---auth)

---

## Connection and server

### `CONNECT_FAILED` (error)

**Means:** the process did not start, exited early, or did not complete the `initialize` handshake. For stdio servers the message ends with the last stderr text of the server.

**Why it matters:** a client that cannot connect shows the server as "failed" or "disconnected" and offers none of its tools.

**Before** (the start command points to a file that does not exist):

```
VIRHE    [CONNECT_FAILED] yhteys tai initialize-kättely epäonnistui: MCP error -32000: Connection closed | palvelimen stderr: Error: Cannot find module ./dist/index.js
```

**After:** read the stderr tail, fix the cause (here: run `npm run build` first, or correct the path), and run again. Typical causes: missing build step, wrong working directory, a missing environment variable (pass it with `--env NAME`, because the server sees only `PATH` and basic variables), or anything printed to stdout that is not JSON-RPC (log to stderr instead).

**Check:** `npx @tonyweckstrom/mcp-doctor -- node dist/index.js` shows the `Palvelin:` line with the server name and tool count.

**Verified:** yes, with a command that prints an error and exits.

### `SERVER_INFO_MISSING` (warning)

**Means:** the server did not report a name (`serverInfo.name`) in the handshake.

**Why it matters:** clients show the name in their server list and logs. Without it, users and bug reports cannot tell servers apart.

**Before / After:**

```ts
// Before: empty name
new McpServer({ name: "", version: "1.0.0" });
// After
new McpServer({ name: "notes-server", version: "1.0.0" });
```

**Check:** the `Palvelin:` line shows `notes-server 1.0.0`, and the warning is gone.

**Verified:** yes (the test server was started with an empty name).

### `TOOLS_CAPABILITY_MISSING` (warning)

**Means:** the server's `initialize` response does not declare the `tools` capability, so mcp-doctor does not list tools at all.

**Why it matters:** a client only calls `tools/list` when the capability is declared. Your tools are invisible, even if the handler exists.

**Before / After** (low-level SDK; `McpServer` declares the capability when you register a tool):

```ts
// Before
new Server({ name: "notes-server", version: "1.0.0" }, { capabilities: {} });
// After
new Server({ name: "notes-server", version: "1.0.0" }, { capabilities: { tools: {} } });
```

**Check:** the `Palvelin:` line shows a tool count and the warning is gone.

**Verified:** yes (before state). The after state is the same server with `tools: {}` declared.

---

## Tool list

### `TOOLS_LIST_FAILED` (error)

**Means:** the `tools/list` request failed. The message holds the error text. With the TypeScript SDK client the same code also appears when the server sends a tool definition that breaks the MCP schema, for example an `inputSchema` whose `type` is not `"object"` or a `required` that is not an array.

**Why it matters:** a failed list means the client gets no tools from this server at all, not just from the broken one.

**Before** (`required` is a string):

```json
{ "name": "search", "inputSchema": { "type": "object", "properties": { "q": { "type": "string" } }, "required": "q" } }
```

```
VIRHE    [TOOLS_LIST_FAILED] tools/list epäonnistui: [ { "expected": "array", "code": "invalid_type", "path": [ "tools", 0, "inputSchema", "required" ], "message": "Invalid input: expected array, received string" } ]
```

**After:** read `path` in the message: it points to the exact field. Here `"required": ["q"]`.

**Check:** run again; the tool count appears on the `Palvelin:` line.

**Verified:** yes, for both a handler that throws (`MCP error -32603`) and the schema example above.

### `TOOLS_EMPTY` (warning)

**Means:** the server declares the `tools` capability, but `tools/list` returns an empty list.

**Why it matters:** the client connects successfully and then shows a server with no tools. This is usually a registration that runs too late (after `connect`) or is skipped by a condition.

**Before / After:** register tools before `server.connect(...)` and check that no environment condition silently skips registration.

**Check:** the tool count on the `Palvelin:` line is above zero.

**Verified:** yes (before state).

### `TOOLS_PAGINATION_LOOP` (warning)

**Means:** `tools/list` returned the same `nextCursor` again, so paging would never end. mcp-doctor stopped listing.

**Why it matters:** a client that follows cursors blindly can hang or spin on this server.

**Fix:** return a new cursor for each page and omit `nextCursor` on the last page. If you do not paginate, never set `nextCursor`.

**Check:** the warning is gone and the tool count equals the number of tools you registered.

**Verified:** yes (before state: a server that always returned the cursor `"x"`). The fixed state was not run separately.

### `TOOLS_PAGINATION_LIMIT` (warning)

**Means:** the list still continued after 50 pages, so mcp-doctor stopped reading.

**Why it matters:** the same as above: an endless or extremely long list. 50 pages is far beyond any sensible tool list, and the definitions would cost many tokens (see [token size](#token-size)).

**Fix:** end the paging (omit `nextCursor` on the last page) or return fewer tools per server; split a very large server into several focused ones.

**Check:** the warning is gone.

**Verified:** yes (before state: a server that returned a new cursor forever). The fixed state was not run separately.

### `TOOL_DUPLICATE` (error)

**Means:** two or more tools share one name.

**Why it matters:** clients key tools by name. One definition silently overrides the other, or the whole list is rejected.

**Before / After:**

```json
// Before
[ { "name": "search", "description": "Search notes by keyword." },
  { "name": "search", "description": "Search users by name." } ]
// After
[ { "name": "search_notes", "description": "Search notes by keyword." },
  { "name": "search_users", "description": "Search users by name." } ]
```

```
VIRHE    [TOOL_DUPLICATE] search: työkalun nimi esiintyy 2 kertaa
```

**Check:** re-run; the error is gone.

**Verified:** yes (before state with two identical names, after state with two distinct names).

---

## Tool names and descriptions

### `TOOL_NAME_INVALID` (error)

**Means:** the name is empty, longer than 128 characters, or contains characters other than `A-Z a-z 0-9 _ - .`.

**Why it matters:** the MCP specification limits tool names to this set. Clients may reject or mangle other names, and the model cannot reliably call them.

**Before / After:** `"search notes!"` becomes `"search_notes"`.

```
VIRHE    [TOOL_NAME_INVALID] search notes!: nimi on tyhjä, yli 128 merkkiä tai sisältää sallittujen merkkien (A-Z a-z 0-9 _ - .) ulkopuolisia merkkejä
```

**Check:** re-run; the error is gone.

**Verified:** yes.

### `TOOL_NAME_PORTABILITY` (warning)

**Means:** the name is valid under the specification, but does not match `[A-Za-z0-9_-]{1,64}`, for example because it contains a dot or is longer than 64 characters.

**Why it matters:** some clients (for example the Claude API) accept only that narrower pattern, so the tool works in one client and fails in another.

**Before / After:** `"notes.search"` becomes `"notes_search"`.

```
VAROITUS [TOOL_NAME_PORTABILITY] notes.search: nimi ei sovi muotoon [A-Za-z0-9_-]{1,64}, jota osa asiakkaista (esim. Claude API) vaatii
```

**Check:** re-run with `--strict`.

**Verified:** yes.

### `TOOL_DESC_MISSING` (warning)

**Means:** the tool has no description (or only whitespace).

**Why it matters:** the model chooses tools by reading the name and description. Without one it has to guess when to use the tool.

**Before / After:**

```json
// Before
{ "name": "search", "inputSchema": { "type": "object", "properties": {} } }
// After
{ "name": "search", "description": "Search notes by keyword and return matching note ids.", "inputSchema": { "type": "object", "properties": {} } }
```

```
VAROITUS [TOOL_DESC_MISSING] search: kuvaus puuttuu: malli ei tiedä milloin työkalua kuuluu käyttää
```

A good description says what the tool does, what it returns, and when to use it instead of a similar tool.

**Check:** re-run with `--strict`.

**Verified:** yes (before state; with a real description the warning disappears, see the next code).

### `TOOL_DESC_SHORT` (info)

**Means:** the description is shorter than 20 characters.

**Why it matters:** a one-word description like `"Search"` does not tell the model what is searched or when to prefer this tool.

**Before / After:** `"Search"` becomes `"Search notes by keyword and return matching note ids."`

```
HUOMIO   [TOOL_DESC_SHORT] search: kuvaus on hyvin lyhyt (6 merkkiä)
```

**Check:** re-run; the note is gone.

**Verified:** yes (before and after).

---

## Input and output schemas

### `SCHEMA_NOT_OBJECT` (error)

**Means:** the tool's `inputSchema` is missing or its `type` is not `"object"`. MCP requires every tool input to be an object.

**Why it matters:** clients build the call arguments from the schema. A non-object root cannot be turned into named arguments.

**Before / After:**

```json
// Before
{ "inputSchema": { "type": "string" } }
// After (a tool with no arguments still needs an empty object schema)
{ "inputSchema": { "type": "object", "properties": {} } }
```

**Check:** re-run; the tool is listed without errors.

**Not verified as `SCHEMA_NOT_OBJECT`:** with mcp-doctor 0.5.0 and its bundled SDK client, this definition is rejected while the list is being read, so the run reports [`TOOLS_LIST_FAILED`](#tools_list_failed-error) with the field path instead (`"path": [ "tools", 0, "inputSchema", "type" ]`, verified). The code itself is covered only by a unit test (`test/lint.test.ts`). The fix is the same.

### `OUTPUT_SCHEMA_NOT_OBJECT` (error)

**Means:** a tool declares an `outputSchema` whose `type` is not `"object"`.

**Why it matters:** structured tool results must be JSON objects, so a client or SDK that validates results against this schema fails on every call.

**Before / After:**

```json
// Before
{ "outputSchema": { "type": "array", "items": { "type": "string" } } }
// After: wrap the array in an object
{ "outputSchema": { "type": "object", "properties": { "ids": { "type": "array", "items": { "type": "string" } } } } }
```

**Check:** re-run; the tool is listed without errors.

**Not verified as `OUTPUT_SCHEMA_NOT_OBJECT`:** like the previous code, the SDK client rejects the list first, and the run shows `TOOLS_LIST_FAILED` with `"path": [ "tools", 0, "outputSchema", "type" ]` (verified). The code itself is covered only by a unit test.

### `SCHEMA_REQUIRED_INVALID` (error)

**Means:** `required` is not a list of strings (the check also applies inside nested objects).

**Why it matters:** the model cannot know which arguments it must send.

**Before / After:**

```json
// Before
{ "type": "object", "properties": { "q": { "type": "string" } }, "required": "q" }
// After
{ "type": "object", "properties": { "q": { "type": "string" } }, "required": ["q"] }
```

**Check:** re-run; the tool is listed without errors.

**Not verified as `SCHEMA_REQUIRED_INVALID`:** a string-valued `required` at the top level is rejected by the SDK client while reading the list, so the run reports `TOOLS_LIST_FAILED` with `"path": [ "tools", 0, "inputSchema", "required" ]` (verified). The code itself is covered only by a unit test.

### `SCHEMA_REQUIRED_UNKNOWN` (error)

**Means:** `required` names a property that is not in `properties`. This is usually a typo or a leftover after a rename.

**Why it matters:** the model is told to send an argument that the schema never describes, and strict validators reject the schema.

**Before / After:**

```json
// Before
{ "type": "object", "properties": { "q": { "type": "string", "description": "Search text" } }, "required": ["query"] }
// After
{ "type": "object", "properties": { "q": { "type": "string", "description": "Search text" } }, "required": ["q"] }
```

```
VIRHE    [SCHEMA_REQUIRED_UNKNOWN] search: pakollinen kenttä 'query' ei ole properties-listassa
```

The check skips objects that use `allOf`, `anyOf`, `oneOf` or `$ref`, because the property may be defined there.

**Check:** re-run; the error is gone.

**Verified:** yes (before state; with `"required": ["q"]` the error disappears).

### `SCHEMA_PROP_DESC_MISSING` (warning)

**Means:** a top-level property has no description.

**Why it matters:** the model fills in arguments based on their descriptions. Without one it guesses the format, units and meaning.

**Before / After** (zod: add `.describe(...)`):

```ts
// Before
inputSchema: { q: z.string() }
// After
inputSchema: { q: z.string().describe("Search text; matched case-insensitively against note bodies") }
```

```
VAROITUS [SCHEMA_PROP_DESC_MISSING] search: kentältä 'q' puuttuu kuvaus
```

**Check:** re-run with `--strict`.

**Verified:** yes.

### `SCHEMA_PROP_UNTYPED` (warning)

**Means:** a top-level property has none of `type`, `enum`, `const`, `$ref`, `anyOf`, `oneOf`, `allOf`, so any JSON value is accepted.

**Why it matters:** the model has no hint about what to send, and validators cannot reject bad input. This often comes from `z.any()`.

**Before / After:**

```json
// Before
{ "q": { "description": "Search text" } }
// After
{ "q": { "type": "string", "description": "Search text" } }
```

```
VAROITUS [SCHEMA_PROP_UNTYPED] search: kentällä 'q' ei ole tyyppiä (type/enum/const/$ref/anyOf/oneOf/allOf): skeema on liian väljä
```

**Check:** re-run with `--strict`.

**Verified:** yes.

### `SCHEMA_ARRAY_ITEMS_MISSING` (warning)

**Means:** an array property (at any depth) has no `items` (or `prefixItems`), so the element type is unknown.

**Why it matters:** some clients reject the whole tool list for this. Gemini does, and so does OpenAI's strict mode, so one such tool can make every tool of the server unusable there.

**Before / After:**

```json
// Before
{ "tags": { "type": "array", "description": "Tags" } }
// After
{ "tags": { "type": "array", "items": { "type": "string" }, "description": "Tags" } }
```

```
VAROITUS [SCHEMA_ARRAY_ITEMS_MISSING] search: taulukkokentältä 'tags' puuttuu items: alkioiden tyyppi on tuntematon, ja osa asiakkaista hylkää skeeman
```

**Check:** re-run with `--strict`.

**Verified:** yes.

### `SCHEMA_NESTED_DESC_MISSING` (info)

**Means:** a property inside a nested object, array item or `anyOf`/`oneOf`/`allOf` branch has no description. The path is in the message, for example `filter.author` or `entities[].name`.

**Why it matters:** the same as for top-level properties, but it is only a note, so existing `--strict` pipelines do not start failing.

**Before / After:**

```json
// Before
{ "filter": { "type": "object", "description": "Filter", "properties": { "author": { "type": "string" } } } }
// After
{ "filter": { "type": "object", "description": "Filter", "properties": { "author": { "type": "string", "description": "Author name" } } } }
```

```
HUOMIO   [SCHEMA_NESTED_DESC_MISSING] search: kentältä 'filter.author' puuttuu kuvaus
```

**Check:** re-run; the note is gone.

**Verified:** yes.

### `SCHEMA_NESTED_PROP_UNTYPED` (info)

**Means:** a nested property has no type. Same as `SCHEMA_PROP_UNTYPED`, one level or more down.

**Before / After:**

```json
// Before
{ "author": { "description": "Author name" } }
// After
{ "author": { "type": "string", "description": "Author name" } }
```

```
HUOMIO   [SCHEMA_NESTED_PROP_UNTYPED] search: kentällä 'filter.author' ei ole tyyppiä (type/enum/const/$ref/anyOf/oneOf/allOf): skeema on liian väljä
```

**Check:** re-run; the note is gone.

**Verified:** yes.

---

## Token size

Clients send every tool definition to the model in every request. See [Token budget in the README](../README.md#token-budget).

### `TOOL_TOKENS_HIGH` (info)

**Means:** one tool definition (name, description and schema) costs an estimated more than 1,000 tokens (characters / 4).

**Why it matters:** you pay this on every request, even when the tool is not used, and it leaves less room for the user's actual work.

**Fix:** shorten the description to what the model needs to choose and call the tool, move long documentation out of the schema, and trim repeated field descriptions.

```
HUOMIO   [TOOL_TOKENS_HIGH] search: työkalun määrittely vie arviolta 1138 tokenia jokaisesta pyynnöstä (raja 1000); lyhennä kuvausta tai skeeman kenttäkuvauksia
```

**Check:** the `Tokenit (arvio):` line shows the new total.

**Verified:** yes (before state: a 4,400-character description; with a one-sentence description the finding does not appear).

### `TOOLS_TOKEN_BUDGET_EXCEEDED` (error)

**Means:** the total estimated size of all tool definitions is above the limit you set with `--max-tokens` (in the action: `max-tokens`). The message names the three largest tools.

**Why it matters:** this is the CI guard against tool definitions growing unnoticed.

**Before / After:** run with `--max-tokens 500`:

```
VIRHE    [TOOLS_TOKEN_BUDGET_EXCEEDED] työkalumäärittelyt vievät arviolta 1138 tokenia, raja on 500 (--max-tokens); suurimmat: search 1138
```

Shorten the named tools, remove tools the server does not need, or raise the limit on purpose after a review. After shortening the description to one sentence the same command prints `0 virhettä ... -> OK`.

**Check:** `npx @tonyweckstrom/mcp-doctor --max-tokens 500 -- node dist/index.js`

**Verified:** yes (before and after).

---

## Smoke calls

Smoke calls run only the tools named in your smoke file (`--smoke smoke.json`, format in the [README](../README.md#use-with-npx)). The examples below use this file unless stated otherwise:

```json
{ "calls": [ { "tool": "search", "arguments": { "q": "a" } } ] }
```

### `SMOKE_TOOL_NOT_FOUND` (error)

**Means:** the smoke file names a tool that is not in the server's list.

**Why it matters:** the call was not made, so the check proves nothing. Usually a typo or a renamed tool.

**Before / After:** `"tool": "serch"` becomes `"tool": "search"`.

```
VIRHE    [SMOKE_TOOL_NOT_FOUND] serch: savuajotiedostossa nimetty työkalu ei ole palvelimen listalla
```

If the tool list itself failed, the message says so; fix `TOOLS_LIST_FAILED` or `TOOLS_CAPABILITY_MISSING` first.

**Check:** the smoke section shows `OK search (...)`.

**Verified:** yes (before and after).

### `SMOKE_TOOL_ERROR` (error)

**Means:** the tool returned `isError: true` and the smoke file did not expect an error. The message includes the first line of the error text.

**Why it matters:** this is a real failure a model would see. Either the tool is broken or the arguments in the smoke file are wrong.

**Fix:** read the error text in the message and fix the tool, or correct `arguments`. If the error is the intended behaviour (for example "not found" for a missing id), say so with `"expectError": true`:

```json
{ "tool": "search", "arguments": { "q": "a" }, "expectError": true }
```

```
VIRHE    [SMOKE_TOOL_ERROR] search: työkalu palautti virheen: Ei löydy
```

**Check:** the smoke section shows `OK search (...)`.

**Verified:** yes (before state; with `expectError` the run is `OK`).

### `SMOKE_EXPECTED_ERROR` (error)

**Means:** the smoke file has `"expectError": true`, but the call succeeded.

**Why it matters:** the error path you wanted to test (validation, permission, not found) does not work.

**Fix:** if the tool should reject these arguments, fix the validation in the tool. If the call is valid after all, remove `expectError` or change the arguments.

```
VIRHE    [SMOKE_EXPECTED_ERROR] search: työkalun odotettiin palauttavan virheen, mutta kutsu onnistui
```

**Check:** the smoke section shows `OK`.

**Verified:** yes (before state; after state is the same call without `expectError`).

### `SMOKE_EXPECTED_PROTOCOL_ERROR` (info)

**Means:** you expected an error and got one, but as a JSON-RPC error (for example `-32602 Invalid params`) instead of a tool result with `isError: true`. The run is still `OK`.

**Why it matters:** MCP recommends reporting tool execution errors as `isError` results so the model can read the message and retry. A protocol error usually does not reach the model in a useful form.

**Fix:** catch the failure inside the tool handler and return `{ isError: true, content: [{ type: "text", text: "Note 999 not found" }] }`. Argument validation errors that the SDK rejects before your handler runs are normal protocol errors and can be left as they are.

```
HUOMIO   [SMOKE_EXPECTED_PROTOCOL_ERROR] search: odotettu virhe tuli JSON-RPC-virheenä (-32602), ei isError-vastauksena: MCP error -32602: MCP error -32602: virheellinen parametri
```

**Check:** the note disappears when the error comes back as an `isError` result.

**Verified:** yes (before state).

### `SMOKE_CALL_FAILED` (error)

**Means:** the call itself failed: timeout (`--timeout-ms`, default 10000), connection loss, a protocol error that was not expected, or a result that breaks the tool's `outputSchema` (missing or invalid `structuredContent`).

**Why it matters:** a client would get the same failure when the model calls the tool.

**Fix:** read the error text. For a protocol error, check the arguments against the schema. For a timeout, make the tool faster or raise `--timeout-ms`. For `outputSchema` problems, return `structuredContent` that matches the schema.

```
VIRHE    [SMOKE_CALL_FAILED] search: kutsu epäonnistui: MCP error -32602: MCP error -32602: virheellinen parametri
```

**Check:** the smoke section shows `OK`.

**Verified:** yes (before state with a JSON-RPC error; timeout and `outputSchema` variants were not run).

### `SMOKE_EMPTY_RESULT` (warning)

**Means:** the call succeeded but returned no `content` and no `structuredContent`.

**Why it matters:** the model gets nothing back and cannot tell whether the call worked. Return at least a short confirmation.

**Before / After:**

```ts
// Before
return { content: [] };
// After
return { content: [{ type: "text", text: "Deleted note 3" }] };
```

```
VAROITUS [SMOKE_EMPTY_RESULT] search: työkalu palautti tyhjän tuloksen
```

**Check:** re-run with `--strict`.

**Verified:** yes (before state).

### `SMOKE_SLOW` (warning)

**Means:** the call took longer than `maxMs` (default 5000 ms; per call in the smoke file).

**Why it matters:** clients and models time out on slow tools, and a long wait feels like a hang.

**Fix:** make the tool faster, or if the time is expected, state it in the smoke file:

```json
{ "tool": "search", "arguments": { "q": "a" }, "maxMs": 2000 }
```

```
VAROITUS [SMOKE_SLOW] search: vastaus kesti 405 ms (raja 100 ms)
```

With `maxMs: 2000` the same 404 ms call is reported as `OK search (404 ms)`.

**Check:** re-run with `--strict`.

**Verified:** yes (before and after).

---

## OAuth (`--auth`)

`--auth` works only together with `--url`. It sends no credentials: one unauthenticated `initialize` request and unauthenticated GET requests for metadata. The examples were run against a local test server that imitates each failure, so URLs are `http://127.0.0.1:<port>` (plain http is accepted only for localhost; real servers must use https). For brevity, only the finding line is quoted. Without `--bearer-env` the run also prints an `AUTH_LOGIN_REQUIRED` note; see below.

Re-check for every code in this section:

```bash
npx @tonyweckstrom/mcp-doctor --auth --url https://your-server.example.com/mcp
```

A healthy setup prints `AUTH_OK`.

### `AUTH_CHECK_FAILED` (error)

**Means:** the unauthenticated `initialize` request did not get an HTTP response (connection refused, DNS failure, timeout).

**Why it matters:** no client can reach the server either, so nothing else can be checked.

**Fix:** check the URL (including the path, usually `/mcp`), that the server is running, and firewall or proxy settings.

```
VIRHE    [AUTH_CHECK_FAILED] kirjautumaton initialize-pyyntö epäonnistui: fetch failed
```

**Verified:** yes (a closed port).

### `AUTH_NOT_REQUIRED` (info)

**Means:** the server did not answer the unauthenticated `initialize` with `401`, so it needs no login and the OAuth check is skipped.

**Why it matters:** if the server is meant to be protected, this is a security problem: anyone can use it. If it is meant to be open, there is nothing to fix.

**Fix:** for a protected server, return `401` with a `WWW-Authenticate` header for requests without a valid token.

```
HUOMIO   [AUTH_NOT_REQUIRED] palvelin vastasi kirjautumattomaan initialize-pyyntöön tilalla 200 eikä 401: kirjautumista ei vaadita, OAuth-tarkistus ohitetaan
```

**Verified:** yes. The test server answered `200` but was not a complete MCP server, so the run also printed a `CONNECT_FAILED` timeout. A real open server would not.

### `AUTH_LOGIN_REQUIRED` (info)

**Means:** the server requires login and you gave no token, so the normal check (tools, smoke calls) could not run. mcp-doctor turns the expected `CONNECT_FAILED` into this note.

**Why it matters:** it is not a fault. It tells you that the tool list was not checked.

**Fix:** to check tools behind the login, create a token yourself, put it in an environment variable and pass the name: `--bearer-env NAME`. Never put the token on the command line.

```
HUOMIO   [AUTH_LOGIN_REQUIRED] palvelin vaatii kirjautumisen: varsinaista tarkastusta ei voi ajaa ilman tokenia (--bearer-env)
```

**Verified:** yes (appears in every `--auth` run against a protected test server).

### `AUTH_WWW_AUTHENTICATE_MISSING` (warning)

**Means:** the `401` response has no `WWW-Authenticate: Bearer` header.

**Why it matters:** the MCP authorization flow starts from this header. Without it the client does not know that OAuth is available or where to look.

**Before / After:**

```
HTTP/1.1 401 Unauthorized

HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://your-server.example.com/.well-known/oauth-protected-resource/mcp"
```

```
VAROITUS [AUTH_WWW_AUTHENTICATE_MISSING] 401-vastauksesta puuttuu WWW-Authenticate: Bearer -otsake: asiakas ei saa vihjettä siitä, mistä kirjautumistiedot löytyvät
```

**Verified:** yes (before state; after state is the healthy server that prints `AUTH_OK`).

### `AUTH_RESOURCE_METADATA_HINT_MISSING` (info)

**Means:** the header says `Bearer` but has no `resource_metadata` parameter. The client has to guess the metadata address from the well-known path.

**Fix:** add `resource_metadata="<url>"` to the header (example above). Many clients work without it, but the parameter is the reliable route.

```
HUOMIO   [AUTH_RESOURCE_METADATA_HINT_MISSING] WWW-Authenticate-otsakkeessa ei ole resource_metadata-parametria: asiakkaan pitää arvata metatietojen osoite (well-known)
```

**Verified:** yes (the run continued with the well-known fallback and found the metadata).

### `AUTH_RESOURCE_METADATA_MISSING` (error)

**Means:** the protected resource metadata (RFC 9728) was not found at the address in the header or at the well-known paths. The message lists the addresses tried with their HTTP status.

**Why it matters:** the client cannot find out which authorization server to use, so login never starts.

**Fix:** serve a JSON document at `/.well-known/oauth-protected-resource/<path>` (for `https://x/mcp`: `https://x/.well-known/oauth-protected-resource/mcp`):

```json
{ "resource": "https://x/mcp", "authorization_servers": ["https://auth.example.com"] }
```

```
VIRHE    [AUTH_RESOURCE_METADATA_MISSING] suojatun resurssin metatietoja (RFC 9728) ei löytynyt: http://127.0.0.1:9104/.well-known/oauth-protected-resource/mcp (404); ...
```

**Verified:** yes (all addresses returned 404).

### `AUTH_RESOURCE_INVALID` (error)

**Means:** the metadata document has no `resource` field (as a string).

**Fix:** add `"resource"` with the server's URL (example above).

```
VIRHE    [AUTH_RESOURCE_INVALID] metatiedoista (http://127.0.0.1:9105/.well-known/oauth-protected-resource/mcp) puuttuu resource-kenttä
```

**Verified:** yes.

### `AUTH_RESOURCE_MISMATCH` (warning)

**Means:** `resource` in the metadata is neither the server URL (without a trailing slash difference) nor its origin.

**Why it matters:** clients bind the token to this resource. A mismatch makes them reject the metadata or request a token for the wrong resource, and the server then refuses it.

**Before / After:** with the server at `https://x/mcp`, change `"resource": "https://x/other"` to `"resource": "https://x/mcp"`.

```
VAROITUS [AUTH_RESOURCE_MISMATCH] metatietojen resource 'http://127.0.0.1:1/other' ei vastaa palvelimen osoitetta 'http://127.0.0.1:9106/mcp': asiakas voi hylätä tokenin tai pyytää sitä väärälle resurssille
```

Behind a reverse proxy the public URL is the one that must match.

**Verified:** yes (before state).

### `AUTH_SERVERS_MISSING` (error)

**Means:** the metadata has no non-empty `authorization_servers` list.

**Why it matters:** the client does not know where to log in.

**Fix:** add the list (example under `AUTH_RESOURCE_METADATA_MISSING`).

```
VIRHE    [AUTH_SERVERS_MISSING] metatiedoista puuttuu authorization_servers: asiakas ei tiedä, missä kirjaudutaan
```

**Verified:** yes (empty list).

### `AUTH_INSECURE_URL` (error)

**Means:** a metadata address, the authorization server, or an endpoint (`authorization_endpoint`, `token_endpoint`) uses `http` and is not on localhost.

**Why it matters:** tokens and authorization codes would travel unencrypted, and clients refuse such flows.

**Before / After:** `"token_endpoint": "http://auth.example.com/token"` becomes `"https://auth.example.com/token"`. Use https for every address in the metadata.

```
VIRHE    [AUTH_INSECURE_URL] valtuutuspalvelin ei ole https: http://example.com
VIRHE    [AUTH_INSECURE_URL] token_endpoint ei ole https: http://example.com/token
```

**Verified:** yes (both forms).

### `AUTH_SERVER_METADATA_MISSING` (error)

**Means:** the first listed authorization server serves no metadata at `/.well-known/oauth-authorization-server` (RFC 8414) or `/.well-known/openid-configuration`.

**Why it matters:** the client cannot discover the login and token endpoints.

**Fix:** publish the authorization server metadata at one of those paths (identity providers usually have a setting for it), or point `authorization_servers` to the right issuer address.

```
VIRHE    [AUTH_SERVER_METADATA_MISSING] valtuutuspalvelimen metatietoja (RFC 8414 / OpenID) ei löytynyt: http://127.0.0.1:9109/.well-known/oauth-authorization-server (404); http://127.0.0.1:9109/.well-known/openid-configuration (404)
```

**Verified:** yes.

### `AUTH_ENDPOINT_MISSING` (error)

**Means:** the authorization server metadata has no `authorization_endpoint` or no `token_endpoint` (the message names which).

**Fix:** add the missing field to the authorization server's metadata:

```json
{ "authorization_endpoint": "https://auth.example.com/authorize", "token_endpoint": "https://auth.example.com/token" }
```

```
VIRHE    [AUTH_ENDPOINT_MISSING] valtuutuspalvelimen metatiedoista puuttuu token_endpoint
```

**Verified:** yes (missing `token_endpoint`).

### `AUTH_PKCE_S256_MISSING` (error)

**Means:** `code_challenge_methods_supported` is missing or does not include `S256`.

**Why it matters:** MCP clients must use PKCE. When the server does not advertise `S256`, they may refuse to log in.

**Before / After:** add `"code_challenge_methods_supported": ["S256"]` to the authorization server metadata (and enable PKCE in the server, if it is a setting).

```
VIRHE    [AUTH_PKCE_S256_MISSING] code_challenge_methods_supported puuttuu tai siitä puuttuu S256: MCP-asiakkaat vaativat PKCE:n ja voivat kieltäytyä kirjautumasta
```

**Verified:** yes (before state).

### `AUTH_REFRESH_TOKEN_UNSUPPORTED` (warning)

**Means:** `grant_types_supported` is present and does not contain `refresh_token`.

**Why it matters:** when the access token expires, the client cannot renew it quietly. The user sees "connection expired" and must log in again.

**Before / After:** `"grant_types_supported": ["authorization_code"]` becomes `["authorization_code", "refresh_token"]`, and make sure the server really issues refresh tokens.

```
VAROITUS [AUTH_REFRESH_TOKEN_UNSUPPORTED] grant_types_supported ei sisällä refresh_token-myöntöä: kun token vanhenee, käyttäjä joutuu kirjautumaan uudelleen ("connection expired")
```

**Verified:** yes (before state).

### `AUTH_REGISTRATION_UNSUPPORTED` (info)

**Means:** the authorization server has neither `registration_endpoint` (dynamic client registration) nor `client_id_metadata_document_supported: true`.

**Why it matters:** a client cannot register itself, so each user must be given a ready `client_id`. That is fine for a private server and a barrier for a public one.

**Fix:** enable dynamic client registration or client ID metadata documents in the authorization server, or document the `client_id` for your users.

```
HUOMIO   [AUTH_REGISTRATION_UNSUPPORTED] ei registration_endpointia eikä client_id_metadata_document_supported-tukea: asiakkaalle pitää antaa valmis client_id
```

**Verified:** yes (before state).

### `AUTH_OK` (info)

**Means:** all OAuth checks passed. It appears only when no other `AUTH_*` finding above info level exists.

```
HUOMIO   [AUTH_OK] OAuth-metatiedot kunnossa (resurssi http://127.0.0.1:9101/.well-known/oauth-protected-resource/mcp, valtuutuspalvelin http://127.0.0.1:9101)
```

**Verified:** yes (a test server with correct metadata).

---

## Not covered

`TOOLS_PAGINATION_LOOP` and `TOOLS_PAGINATION_LIMIT` after states, and the timeout and `outputSchema` variants of `SMOKE_CALL_FAILED`, were not run. `SCHEMA_NOT_OBJECT`, `OUTPUT_SCHEMA_NOT_OBJECT` and `SCHEMA_REQUIRED_INVALID` are unit-tested but could not be reproduced end to end (see their sections).
