# mcp-doctor

*English: [README.md](README.md).*

Terveystarkastus MCP-palvelimelle. Yksi komento kertoo, toimiiko palvelimesi: vastaako se `initialize`-kättelyyn, ovatko työkalujen kuvaukset ja skeemat kunnossa ja onnistuvatko oikeat työkalukutsut. Raportti on luettava ihmiselle ja koneelle (JSON), ja poistumiskoodi sopii CI:hin.

*English summary: a CLI and GitHub Action that checks an MCP server's health: handshake, tool-schema lint and smoke calls with explicit example arguments. Human-readable or JSON report, exit code for CI, no API keys, no network access besides the server you point it at.*

Miksi: MCP-asiakkaat (Claude Desktop, Cursor) antavat vähän tietoa, kun palvelin tai työkalun skeema on rikki. Työkalu vain puuttuu listalta tai malli käyttää sitä väärin, ja kehittäjä jää arvailemaan. mcp-doctor löytää ongelmat ennen asiakasta.

**Demo 3 minuutissa:** [docs/demo.md](docs/demo.md) näyttää saman palvelimen ennen ja jälkeen korjausten (`npm run demo:ennen`, `npm run demo:jalkeen`). *Three-minute before/after demo, English included.*

**CI-käyttöohje:** [docs/ci.md](docs/ci.md) (GitHub Actions -esimerkki, poistumiskoodit, `--strict`).

## Asennus

Ei asennusta: aja suoraan npm:stä (Node 22.12+ tai 24):

```bash
npx @tonyweckstrom/mcp-doctor -- node ./oma-palvelin/dist/index.js
```

Tai asenna globaalisti (komento on silloin `mcp-doctor`):

```bash
npm install -g @tonyweckstrom/mcp-doctor
mcp-doctor --version
```

Tai lähteistä:

```bash
git clone https://github.com/tonyweckstrom1987/mcp-doctor.git
cd mcp-doctor
npm ci          # asentaa ja kääntää (prepare-skripti)
node dist/bin.js --help
```

## Käyttö

stdio-palvelin (komento annetaan `--`-merkin jälkeen):

```bash
npx @tonyweckstrom/mcp-doctor -- node ../oma-palvelin/dist/index.js
```

HTTP-palvelin (Streamable HTTP), tarvittaessa Bearer-tokenilla ympäristömuuttujasta:

```bash
export DOCTOR_TOKEN=...   # kirjoita itse, älä liitä tokenia komentoriville
npx @tonyweckstrom/mcp-doctor --url http://127.0.0.1:3000/mcp --bearer-env DOCTOR_TOKEN
```

Esimerkkituloste (mcp-server-starter, savuajolla):

```
mcp-doctor: node ../starter/dist/index.js
Palvelin: mcp-server-starter 0.1.0, 2 työkalua
Savuajo:
  OK     greet (4 ms)
  OK     add (1 ms)
Yhteenveto: 0 virhettä, 0 varoitusta, 0 huomiota -> OK
```

Ja kun palvelimessa on vikoja (testipalvelin, jossa on päällekkäisiä ja vajaasti kuvattuja työkaluja), tulos on virheitä ja poistumiskoodi `1`:

```
mcp-doctor: node bad-tools-server.mjs
Palvelin: huono-palvelin 0.0.1, 4 työkalua
VIRHE    [TOOL_DUPLICATE] dup: työkalun nimi esiintyy 2 kertaa
VIRHE    [TOOL_NAME_INVALID] no desc!: nimi on tyhjä, yli 128 merkkiä tai sisältää sallittujen merkkien (A-Z a-z 0-9 _ - .) ulkopuolisia merkkejä
VIRHE    [SCHEMA_REQUIRED_UNKNOWN] loose: pakollinen kenttä 'z' ei ole properties-listassa
VAROITUS [TOOL_DESC_MISSING] no desc!: kuvaus puuttuu: malli ei tiedä milloin työkalua kuuluu käyttää
VAROITUS [SCHEMA_PROP_UNTYPED] loose: kentällä 'x' ei ole tyyppiä (type/enum/const/$ref/anyOf/oneOf/allOf): skeema on liian väljä
VAROITUS [SCHEMA_PROP_DESC_MISSING] loose: kentältä 'x' puuttuu kuvaus
VAROITUS [SCHEMA_PROP_DESC_MISSING] loose: kentältä 'y' puuttuu kuvaus
Yhteenveto: 3 virhettä, 4 varoitusta, 0 huomiota -> EPÄONNISTUI
```

| Valinta | Selitys |
| --- | --- |
| `--smoke <tiedosto>` | savuajo: kutsuu vain tiedostossa nimetyt työkalut |
| `--json` | raportti JSONina |
| `--strict` | varoituksetkin kaatavat ajon |
| `--timeout-ms <luku>` | yksittäisen pyynnön aikakatkaisu, oletus 10000, enintään 2147483647 (Noden ajastimen raja) |
| `--env <NIMI>` | välittää ympäristömuuttujan stdio-palvelimelle (toistettava) |
| `--bearer-env <NIMI>` | HTTP-palvelimen Bearer-token tästä muuttujasta |
| `--auth` | HTTP-palvelimen OAuth-tarkistus (401, WWW-Authenticate, RFC 9728 ja 8414 -metatiedot, PKCE S256, refresh_token) |
| `--max-tokens <luku>` | tokenimittarin raja: työkalumäärittelyjen arvioitu yhteiskoko, ylitys on virhe |
| `--version` | tulostaa version |

Poistumiskoodit: `0` kunnossa, `1` löydöksiä (virhe, tai varoitus `--strict`-tilassa), `2` käyttö- tai tiedostovirhe, `3` odottamaton sisäinen virhe.

## Mitä tarkistetaan

| Tunniste | Vakavuus | Mitä |
| --- | --- | --- |
| `CONNECT_FAILED` | virhe | yhteys tai `initialize` epäonnistui, myös tuntematon protokollaversio. Viestissä näkyy stdio-palvelimen viimeinen stderr-teksti |
| `SERVER_INFO_MISSING` | varoitus | palvelin ei kerro nimeään |
| `TOOLS_CAPABILITY_MISSING` | varoitus | palvelin ei ilmoita tools-kykyä |
| `TOOLS_LIST_FAILED` | virhe | `tools/list` epäonnistui |
| `TOOLS_EMPTY` | varoitus | tools-kyky ilmoitettu, mutta lista tyhjä |
| `TOOLS_PAGINATION_LIMIT` | varoitus | lista jatkui yli 50 sivua, luku keskeytettiin |
| `TOOL_DUPLICATE` | virhe | sama nimi useammin kuin kerran |
| `TOOL_NAME_INVALID` | virhe | tyhjä, yli 128 merkkiä tai muita merkkejä kuin `A-Z a-z 0-9 _ - .` |
| `TOOL_NAME_PORTABILITY` | varoitus | ei sovi muotoon `[A-Za-z0-9_-]{1,64}`, jota osa asiakkaista vaatii |
| `TOOL_DESC_MISSING` / `TOOL_DESC_SHORT` | varoitus / huomio | kuvaus puuttuu / alle 20 merkkiä |
| `SCHEMA_NOT_OBJECT` | virhe | syöteskeema puuttuu tai sen `type` ei ole `object` |
| `SCHEMA_REQUIRED_INVALID` / `SCHEMA_REQUIRED_UNKNOWN` | virhe | `required` ei ole merkkijonolista / viittaa kenttään, jota ei ole |
| `SCHEMA_PROP_DESC_MISSING` | varoitus | kentältä puuttuu kuvaus |
| `SCHEMA_PROP_UNTYPED` | varoitus | kentällä ei ole `type`/`enum`/`const`/`$ref`/`anyOf`/`oneOf`/`allOf` |
| `SCHEMA_ARRAY_ITEMS_MISSING` | varoitus | taulukkokentältä puuttuu `items` (millä tahansa tasolla); esim. Gemini ja OpenAI:n strict-tila hylkäävät skeeman |
| `SCHEMA_NESTED_DESC_MISSING` / `SCHEMA_NESTED_PROP_UNTYPED` | huomio | sisäkkäisen objektin, taulukon alkion tai `anyOf`/`oneOf`/`allOf`-haaran kentältä puuttuu kuvaus / tyyppi. Polku näkyy viestissä, esim. `entities[].name` tai `filter.anyOf[0].name` |
| `AUTH_*` (`--auth`) | virhe / varoitus / huomio | OAuth: `AUTH_RESOURCE_METADATA_MISSING`, `AUTH_SERVERS_MISSING`, `AUTH_SERVER_METADATA_MISSING`, `AUTH_ENDPOINT_MISSING`, `AUTH_PKCE_S256_MISSING`, `AUTH_INSECURE_URL`, `AUTH_CHECK_FAILED`, `AUTH_RESOURCE_INVALID` (virhe); `AUTH_WWW_AUTHENTICATE_MISSING`, `AUTH_RESOURCE_MISMATCH`, `AUTH_REFRESH_TOKEN_UNSUPPORTED` (varoitus); `AUTH_RESOURCE_METADATA_HINT_MISSING`, `AUTH_REGISTRATION_UNSUPPORTED`, `AUTH_LOGIN_REQUIRED`, `AUTH_NOT_REQUIRED`, `AUTH_FORBIDDEN`, `AUTH_OK` (huomio) |
| `TOOL_TOKENS_HIGH` | huomio | yksittäisen työkalun määrittely vie arviolta yli 1 000 tokenia |
| `TOOLS_TOKEN_BUDGET_EXCEEDED` | virhe | työkalumäärittelyjen arvioitu yhteiskoko ylittää `--max-tokens`-rajan |
| `OUTPUT_SCHEMA_NOT_OBJECT` | virhe | `outputSchema` ei ole `object` |
| `SMOKE_TOOL_NOT_FOUND` | virhe | savuajotiedosto nimeää työkalun, jota palvelimella ei ole |
| `SMOKE_TOOL_ERROR` | virhe | työkalu palautti `isError`, vaikka virhettä ei odotettu |
| `SMOKE_EXPECTED_ERROR` | virhe | odotettu virhe jäi tulematta |
| `SMOKE_CALL_FAILED` | virhe | kutsu epäonnistui (aikakatkaisu, protokollavirhe, `outputSchema`-vaatimus rikottu) |
| `SMOKE_EMPTY_RESULT` | varoitus | tulos on tyhjä |
| `SMOKE_SLOW` | varoitus | vastaus kesti yli `maxMs` (oletus 5000) |

## OAuth-tarkistus (`--auth`)

Moni MCP-kirjautumisongelma ("connection expired", kirjautuminen ei käynnisty, 401 ilman selitystä) johtuu palvelimen tai valtuutuspalvelimen metatiedoista. `--auth` tarkistaa ne kirjautumatta:

```bash
npx @tonyweckstrom/mcp-doctor --auth --url https://oma-palvelin.example.com/mcp
```

1. Kirjautumaton `initialize`: palvelimen pitää vastata `401` ja `WWW-Authenticate: Bearer resource_metadata="..."`.
2. Suojatun resurssin metatiedot (RFC 9728): `resource` vastaa palvelimen osoitetta, ja `authorization_servers` on annettu.
3. Valtuutuspalvelimen metatiedot (RFC 8414 tai OpenID Connect): päätepisteet https:nä, PKCE `S256`, `refresh_token`-myöntö (muuten käyttäjä joutuu kirjautumaan uudelleen tokenin vanhetessa) ja asiakkaan rekisteröinti.

Tarkistus ei lähetä tunnuksia. Huomaa, että se tekee kirjautumattomia GET-pyyntöjä myös valtuutuspalvelimelle, jonka palvelin ilmoittaa. Jos annat lisäksi `--bearer-env`, varsinainen tarkastus (työkalut, savuajo) tehdään tokenilla.

*English: `--auth` checks an HTTP MCP server's OAuth setup without credentials: 401 + WWW-Authenticate, RFC 9728 protected resource metadata, RFC 8414/OIDC authorization server metadata, PKCE S256, refresh_token grant, client registration and https.*

## Tokenimittari

Asiakas (Claude, Cursor ym.) lähettää mallille jokaisen työkalun nimen, kuvauksen ja syöteskeeman **jokaisessa pyynnössä**, vaikka työkalua ei käytettäisi. Monen palvelimen kanssa työkalumäärittelyt voivat viedä kymmeniä tuhansia tokeneita ennen kuin käyttäjä on sanonut mitään. mcp-doctor raportoi koon jokaisessa ajossa:

```
$ npx @tonyweckstrom/mcp-doctor --max-tokens 200 -- node examples/demo/jalkeen.mjs
VIRHE    [TOOLS_TOKEN_BUDGET_EXCEEDED] työkalumäärittelyt vievät arviolta 257 tokenia, raja on 200 (--max-tokens); suurimmat: add_note 104, search_notes 84, delete_note 69
Tokenit (arvio): työkalumäärittelyt yhteensä 257 / raja 200; suurimmat: add_note 104, search_notes 84, delete_note 69
```

`--max-tokens 4000` (actionissa `max-tokens: 4000`) tekee siitä CI-rajan: kun joku lisää työkalun tai paisuttaa kuvausta yli rajan, ajo kaatuu ja viesti kertoo suurimmat työkalut. Arvio on merkit / 4, eli suuntaa antava (noin ±25 % mallista riippuen). Se sopii vertailuun ja rajaksi, ei laskutukseen.

*English: mcp-doctor estimates how many tokens your tool definitions cost in every request (name + description + input schema, chars/4) and can fail CI with `--max-tokens`.*

## Savuajo

Savuajo kutsuu **vain** tiedostossa nimettyjä työkaluja, annetuilla argumenteilla. Työkaluja ei kutsuta arvaamalla, koska työkalu voi muuttaa dataa. Jätä muokkaavat työkalut pois tai käytä niille testiympäristöä.

```json
{
  "calls": [
    { "tool": "greet", "arguments": { "name": "Tony" } },
    { "tool": "poista_kaikki", "arguments": {}, "expectError": true },
    { "tool": "hidas_haku", "arguments": { "q": "x" }, "maxMs": 15000 }
  ]
}
```

Kentät: `tool` (pakollinen), `arguments` (oletus `{}`), `expectError` (oletus `false`), `maxMs` (oletus 5000). Pelkkä taulukko käy myös.

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

Pin to a version tag or a commit SHA, never `@main`. All inputs are listed below.

## GitHub Action

```yaml
- uses: actions/checkout@v7
- run: npm ci && npm run build        # oma palvelimesi
- uses: tonyweckstrom1987/mcp-doctor@v0.5.0
  with:
    command: node dist/index.js
    smoke: smoke.json
    strict: "true"
```

Lukitse Action versiotagiin (`@v0.5.0`) tai tiukemmin commit-SHA:han, älä `@main`-haaraan. Syötteet: `command` tai `url`, `smoke`, `strict`, `timeout-ms`, `env-names`, `bearer-env`, `auth`, `max-tokens`. Stdio-palvelin näkee vain nimeämäsi ympäristömuuttujat: aseta arvot action-askeleen `env`-lohkossa ja listaa nimet syötteellä `env-names` (välilyönnein erotettuna). HTTP-palvelimen tokenin aseta samoin `env`-lohkossa secretistä ja anna muuttujan nimi syötteellä `bearer-env`. Syötteet välitetään kuoreen ympäristömuuttujina, ei komentoriville, joten ne eivät voi injektoida komentoja.

## Turvallisuus

- Työkalu käynnistää komennon, jonka itse annat, ja puhuu vain sille palvelimelle. Ainoa poikkeus on `--auth`, joka hakee kirjautumatta myös palvelimen ilmoittaman valtuutuspalvelimen metatiedot. API-avaimia ei ole.
- Stdio-palvelin saa vain `PATH`- ja perusmuuttujat. Muut ympäristömuuttujat välitetään vain nimeämällä ne `--env`-valinnalla.
- Bearer-token luetaan ympäristömuuttujasta, ei komentoriviltä, eikä sitä tulosteta. Tulostuva kohde-osoite jättää kyselyparametrit pois.
- Stdio-komennon tulostuvasta kohderivistä peitetään salaiselta näyttävät argumentit (`--token`, `--api-key`, `--password`, `NIMI_TOKEN=…`, URL:n tunnukset ja kyselyparametrit). Peitto on varaverkko: välitä salaisuudet mieluiten `--env`-valinnalla, älä komentoriviltä.
- `--env`-valinnalla välitetyt arvot ja `--bearer-env`-token (vähintään 8 merkkiä) peitetään merkinnällä `***` koko raportista, myös palvelimen stderristä ja virheviesteistä.
- Raportti ei sisällä työkalujen tuloksia, vain virheen ensimmäisen tekstirivin (enintään 300 merkkiä).
- Yhteysvirheen viestiin liitetään stdio-palvelimen viimeinen stderr-teksti. Jos palvelimesi kirjoittaa lokiin salaisuuksia, ne päätyvät CI-lokiin.

## Vaihtoehtoja ja miksi tämä

Tilanne 16.10.2026. MCP-palvelimen testaamiseen on jo muitakin työkaluja, ja jotkut niistä ovat laajempia kuin tämä:

- [`@mcpjam/cli`](https://www.npmjs.com/package/@mcpjam/cli) on laaja testaus- ja virheenetsintätyökalu: yhteystarkistukset, OAuth-vaatimustenmukaisuus, protokollatarkistukset, työkalujen vertailu ja pilvipalvelu. Jos tarvitset OAuth-testejä tai kattavaa protokollakonformanssia, käytä sitä. Se kerää oletuksena anonyymiä käyttötilastoa (poistettavissa valinnalla `--no-telemetry`).
- MCP Inspector -tyyppiset työkalut (esim. `@modelcontextprotocol/inspector`) on tehty palvelimen käsin tutkimiseen ja kokeiluun selaimessa tai komentorivillä, ei pelkkään pass/fail-tarkistukseen CI:ssä.

mcp-doctor on tarkoituksella pieni ja rajattu yhteen tehtävään: yksi komento CI:ssä, joka kaatuu, kun palvelin tai sen työkalukuvaukset ovat rikki. Erot:

- **Kuvausten laatu mallin kannalta:** tarkistaa, että työkalulla on kuvaus ja että skeeman kentät ovat tyypitetty ja kuvattu, koska malli valitsee ja täyttää työkalut näiden perusteella.
- **Savuajo vain nimeämillesi työkaluille:** työkaluja kutsutaan vain tiedostossa (`--smoke`) nimetyillä, itse määritellyillä argumenteilla. Mitään ei kutsuta arvaamalla.
- **Ei verkkoa muualle:** työkalu puhuu vain osoittamallesi palvelimelle. Ei API-avaimia, ei tilastoja, ei tiliä.
- **Eristetty Action:** stdio-palvelin näkee vain nimeämäsi ympäristömuuttujat, ja Actionin syötteet eivät pääse komentoriville.
- **Pieni ja testattu:** vähän koodia, 164 testiä oikeilla stdio- ja HTTP-testipalvelimilla.

## Rajaukset

Ei tue vanhaa SSE-siirtoa eikä OAuth-kirjautumista. Tarkistaa työkalut, ei `resources`- tai `prompts`-osioita. JSON Schema -validointi on kevyt (rakenne, `required`, tyypit, kuvaukset, sisäkkäiset objektit, taulukon alkiot (myös tuple-muoto) ja `anyOf`/`oneOf`/`allOf`-haarat 8 tasoon asti), ei täyttä skeemavalidointia. `$ref`-viittauksia ei seurata.

## Kehitys

```bash
npm ci
npm run typecheck
npm test        # 164 testiä, käynnistää oikeita stdio- ja HTTP-testipalvelimia
```

Testit ajetaan oikeita MCP-palvelimia vastaan (`test/fixtures/`): kunnossa oleva, huonosti määritelty, väärää protokollaversiota puhuva, heti kaatuva sekä sivuttava. Ennen julkaisua koodiin tehtiin tahallisia rikkomisia (mutaatiot), (22 kappaletta), ja jokainen niistä kaatoi testin.

## Lisenssi

MIT
