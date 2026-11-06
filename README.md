# mcp-doctor

Health check for MCP servers: one command, or one GitHub Action step, that tells you whether your server completes the `initialize` handshake, has well-formed tool descriptions and schemas, and answers real tool calls.

*Suomenkielinen versio: [README.fi.md](README.fi.md).*

## Use as a GitHub Action

Copy this into `.github/workflows/mcp-doctor.yml` (also in [examples/workflow.yml](examples/workflow.yml)). It builds your server, starts it, and fails the job if mcp-doctor finds problems:

```yaml
name: mcp-doctor
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: { node-version: 24 }
      - run: npm ci && npm run build   # build your own server
      - uses: tonyweckstrom1987/mcp-doctor@v0.5.0
        with:
          command: node dist/index.js  # your server's start command
          strict: "true"               # warnings fail the job too
```

Pin to a version tag or a commit SHA, never `@main`.

Inputs: `command` or `url` (use one of them), `smoke`, `strict`, `timeout-ms`, `env-names`, `bearer-env`, `auth` (OAuth check for `url`), `max-tokens` (token budget) and `sarif` (unreleased, see below).

- A stdio server sees only the environment variables you name. Set the values in the `env` block of the action step and list the names (separated by spaces) in `env-names`.
- For an HTTP server, set the token from a secret in the `env` block and pass the variable's name in `bearer-env`.
- Inputs are passed to the shell as environment variables, not on the command line, so they cannot inject commands.

More CI detail (exit codes, `--strict`): [docs/ci.md](docs/ci.md) (in Finnish).

## Findings in GitHub code scanning (SARIF) and README badge

> **Unreleased.** `--sarif`, the `sarif` action input and the examples below are not in a published version yet (latest release: v0.5.0). They will be available after the next release.

`--sarif <file>` writes the findings as [SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html). Each finding becomes a result: `ruleId` is the finding code, `level` is `error`, `warning` or `note` (info), and the location is the checked command or URL (the server has no source file). `tool.driver.rules` lists every code with a description. The file is written even when the run fails, so findings reach GitHub exactly when they matter. Text that comes from the server is sanitized the same way as in the text report.

Full example: [examples/workflow-sarif.yml](examples/workflow-sarif.yml). The key parts:

```yaml
permissions:
  contents: read
  security-events: write          # needed by upload-sarif
# ...
      - uses: tonyweckstrom1987/mcp-doctor@v0.5.0   # use the release that includes `sarif`
        with:
          command: node dist/index.js
          sarif: mcp-doctor.sarif
      - uses: github/codeql-action/upload-sarif@v4
        if: always()              # upload also when mcp-doctor failed the job
        with:
          sarif_file: mcp-doctor.sarif
          category: mcp-doctor
```

Findings then appear in the repository's Security tab (code scanning). Code scanning needs GitHub Advanced Security on private repositories; it is free for public ones.

Badge for your README (links back to mcp-doctor):

```markdown
[![checked with mcp-doctor](https://img.shields.io/badge/checked%20with-mcp--doctor-blue)](https://github.com/tonyweckstrom1987/mcp-doctor)
```

It is a static shields.io badge and says only that the project uses mcp-doctor, not that the check passed.

## Use with npx

No installation needed (Node 22.12+ or 24):

```bash
npx @tonyweckstrom/mcp-doctor -- node ./my-server/dist/index.js
```

The server command goes after `--`. For a Streamable HTTP server, optionally with a Bearer token read from an environment variable:

```bash
export DOCTOR_TOKEN=...   # set it yourself, do not paste the token on the command line
npx @tonyweckstrom/mcp-doctor --url http://127.0.0.1:3000/mcp --bearer-env DOCTOR_TOKEN
```

Or install globally (the command is then `mcp-doctor`):

```bash
npm install -g @tonyweckstrom/mcp-doctor
mcp-doctor --version
```

Example output with smoke calls. The tool and finding messages in the report are in Finnish at the moment:

```
mcp-doctor: node ../starter/dist/index.js
Palvelin: mcp-server-starter 0.1.0, 2 työkalua
Savuajo:
  OK     greet (4 ms)
  OK     add (1 ms)
Yhteenveto: 0 virhettä, 0 varoitusta, 0 huomiota -> OK
```

| Option | Meaning |
| --- | --- |
| `--smoke <file>` | smoke calls: calls only the tools named in the file |
| `--json` | report as JSON |
| `--sarif <file>` | write findings as SARIF 2.1.0 for GitHub code scanning (**unreleased**, see below) |
| `--strict` | warnings fail the run too |
| `--timeout-ms <number>` | timeout for a single request, default 10000 |
| `--env <NAME>` | pass an environment variable to the stdio server (repeatable) |
| `--bearer-env <NAME>` | read the HTTP server's Bearer token from this variable |
| `--auth` | OAuth check, only together with `--url` (401, WWW-Authenticate, RFC 9728 and 8414 metadata, PKCE S256, refresh_token) |
| `--max-tokens <number>` | token budget: estimated total size of the tool definitions; exceeding it is an error |
| `--version` | print the version |

Exit codes: `0` healthy, `1` findings (an error, or a warning with `--strict`), `2` usage or file error, `3` unexpected internal error.

Smoke calls run **only** the tools named in the smoke file, with the arguments you give. Tools are never called by guessing, because a tool may change data. Leave out tools that modify data or point them at a test environment.

```json
{
  "calls": [
    { "tool": "greet", "arguments": { "name": "Tony" } },
    { "tool": "delete_all", "arguments": {}, "expectError": true },
    { "tool": "slow_search", "arguments": { "q": "x" }, "maxMs": 15000 }
  ]
}
```

Fields: `tool` (required), `arguments` (default `{}`), `expectError` (default `false`), `maxMs` (default 5000). A plain array also works.

## What it checks

| Code | Severity | What |
| --- | --- | --- |
| `CONNECT_FAILED` | error | connection or `initialize` failed, including an unknown protocol version. For stdio servers the message includes the last stderr text |
| `SERVER_INFO_MISSING` | warning | the server does not report its name |
| `TOOLS_CAPABILITY_MISSING` | warning | the server does not declare the tools capability |
| `TOOLS_LIST_FAILED` | error | `tools/list` failed |
| `TOOLS_EMPTY` | warning | tools capability declared, but the list is empty |
| `TOOLS_PAGINATION_LIMIT` | warning | the list continued past 50 pages, reading was stopped |
| `TOOLS_PAGINATION_LOOP` | warning | the server returned the same `nextCursor` again, listing was stopped |
| `TOOL_DUPLICATE` | error | the same tool name appears more than once |
| `TOOL_NAME_INVALID` | error | empty, longer than 128 characters, or characters other than `A-Z a-z 0-9 _ - .` |
| `TOOL_NAME_PORTABILITY` | warning | does not match `[A-Za-z0-9_-]{1,64}`, which some clients require |
| `TOOL_DESC_MISSING` / `TOOL_DESC_SHORT` | warning / info | description missing / shorter than 20 characters |
| `SCHEMA_NOT_OBJECT` | error | input schema is missing or its `type` is not `object` |
| `SCHEMA_REQUIRED_INVALID` / `SCHEMA_REQUIRED_UNKNOWN` | error | `required` is not a list of strings / names a property that does not exist |
| `SCHEMA_PROP_DESC_MISSING` | warning | a property has no description |
| `SCHEMA_PROP_UNTYPED` | warning | a property has none of `type`/`enum`/`const`/`$ref`/`anyOf`/`oneOf`/`allOf` |
| `SCHEMA_ARRAY_ITEMS_MISSING` | warning | an array property has no `items` (at any level); for example Gemini and OpenAI strict mode reject such schemas |
| `SCHEMA_NESTED_DESC_MISSING` / `SCHEMA_NESTED_PROP_UNTYPED` | info | a property inside a nested object, array item or `anyOf`/`oneOf`/`allOf` branch has no description / type. The path is in the message, e.g. `entities[].name` |
| `TOOL_TOKENS_HIGH` | info | a single tool definition costs an estimated more than 1,000 tokens |
| `TOOLS_TOKEN_BUDGET_EXCEEDED` | error | the estimated total size of the tool definitions exceeds `--max-tokens` |
| `AUTH_*` (`--auth`) | error / warning / info | OAuth: `AUTH_RESOURCE_METADATA_MISSING`, `AUTH_SERVERS_MISSING`, `AUTH_SERVER_METADATA_MISSING`, `AUTH_ENDPOINT_MISSING`, `AUTH_PKCE_S256_MISSING`, `AUTH_INSECURE_URL`, `AUTH_CHECK_FAILED`, `AUTH_RESOURCE_INVALID` (error); `AUTH_WWW_AUTHENTICATE_MISSING`, `AUTH_RESOURCE_MISMATCH`, `AUTH_REFRESH_TOKEN_UNSUPPORTED` (warning); `AUTH_RESOURCE_METADATA_HINT_MISSING`, `AUTH_REGISTRATION_UNSUPPORTED`, `AUTH_LOGIN_REQUIRED`, `AUTH_NOT_REQUIRED`, `AUTH_FORBIDDEN`, `AUTH_OK` (info) |
| `OUTPUT_SCHEMA_NOT_OBJECT` | error | `outputSchema` is not an `object` |
| `SMOKE_TOOL_NOT_FOUND` | error | the smoke file names a tool the server does not have |
| `SMOKE_TOOL_ERROR` | error | the tool returned `isError` although no error was expected |
| `SMOKE_EXPECTED_ERROR` | error | an expected error did not occur |
| `SMOKE_EXPECTED_PROTOCOL_ERROR` | info | the expected error came as a JSON-RPC error, not as an `isError` result |
| `SMOKE_CALL_FAILED` | error | the call failed (timeout, protocol error, `outputSchema` requirement violated) |
| `SMOKE_EMPTY_RESULT` | warning | the result is empty |
| `SMOKE_SLOW` | warning | the response took longer than `maxMs` (default 5000) |

How to fix each finding, with before/after examples: [docs/fixes.md](docs/fixes.md).

Nested schemas are checked up to 8 levels deep. The check is lightweight (structure, `required`, types, descriptions), not full JSON Schema validation, and `$ref` references are not followed.

## Token budget

Clients (Claude, Cursor and others) send every tool's name, description and input schema to the model **in every request**, whether the tool is used or not. With several servers, tool definitions can take tens of thousands of tokens before the user has said anything. mcp-doctor reports the size on every run:

```
$ npx @tonyweckstrom/mcp-doctor --max-tokens 200 -- node examples/demo/jalkeen.mjs
VIRHE    [TOOLS_TOKEN_BUDGET_EXCEEDED] työkalumäärittelyt vievät arviolta 257 tokenia, raja on 200 (--max-tokens); suurimmat: add_note 104, search_notes 84, delete_note 69
Tokenit (arvio): työkalumäärittelyt yhteensä 257 / raja 200; suurimmat: add_note 104, search_notes 84, delete_note 69
```

`--max-tokens 4000` (in the action: `max-tokens: "4000"`) turns it into a CI budget: when someone adds a tool or grows a description past the limit, the job fails and the message names the largest tools. The estimate is characters / 4, so treat it as a guide (roughly ±25 % depending on the model's tokenizer). It is good for comparison and budgets, not for billing. In the JSON report the numbers are in the `tokens` field.

## OAuth check (`--auth`)

Many MCP login problems ("connection expired", login never starts, a bare 401) come from the server's or the authorization server's metadata. `--auth` checks them without logging in:

```bash
npx @tonyweckstrom/mcp-doctor --auth --url https://your-server.example.com/mcp
```

1. Unauthenticated `initialize`: the server should answer `401` with `WWW-Authenticate: Bearer resource_metadata="..."`.
2. Protected resource metadata (RFC 9728): `resource` matches the server URL and `authorization_servers` is present.
3. Authorization server metadata (RFC 8414 or OpenID Connect discovery): https endpoints, PKCE `S256`, the `refresh_token` grant (without it users must log in again whenever the token expires) and client registration.

The check never sends credentials. Note that it also makes unauthenticated GET requests to the authorization server that the server advertises. If you also pass `--bearer-env`, the main check (tools, smoke calls) runs with the token.

## Security

- The tool starts the command you give it and talks only to that server. The only exception is `--auth`, which also fetches the advertised authorization server's metadata without credentials. No API keys are needed.
- A stdio server receives only `PATH` and basic variables. Other environment variables are passed only if you name them with `--env`.
- The Bearer token is read from an environment variable, not from the command line, and it is never printed. The printed target address omits query parameters.
- In the printed target line of a stdio command, arguments that look secret are masked (`--token`, `--api-key`, `--password`, `NAME_TOKEN=…`, credentials and query parameters in URLs). This is a safety net: pass secrets with `--env` rather than on the command line.
- The report contains no tool results, only the first line of an error text (at most 300 characters).
- A connection error message includes the last stderr text of a stdio server. If your server logs secrets there, they end up in the CI log.

## Limitations

No legacy SSE transport. SARIF locations point to the checked command or URL, not to a source line, because mcp-doctor does not know the server's source files. `--auth` checks the OAuth configuration but does not log in. It checks tools only, not `resources` or `prompts`.

## More

- [docs/demo.md](docs/demo.md): three-minute before/after demo (`npm run demo:ennen`, `npm run demo:jalkeen`), English included.
- [CHANGELOG.md](CHANGELOG.md), [README.fi.md](README.fi.md) (full documentation in Finnish, including a comparison with other MCP testing tools).

## Development

```bash
npm ci
npm run typecheck
npm test        # starts real stdio and HTTP test servers
```

## License

MIT
