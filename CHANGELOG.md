# Changelog

Muoto perustuu [Keep a Changelogiin](https://keepachangelog.com/fi/1.0.0/), ja versiointi noudattaa [Semantic Versioningia](https://semver.org/lang/fi/).

## [Julkaisematon]

### Lisätty

- `--sarif <tiedosto>` ja actionin syöte `sarif`: löydökset SARIF 2.1.0 -muodossa GitHubin code scanningia varten (`ruleId` = löydöskoodi, `level` error/warning/note, sijaintina tarkastettu komento tai osoite, `tool.driver.rules` kaikista koodeista). Tiedosto kirjoitetaan myös epäonnistuneesta ajosta. Esimerkki `examples/workflow-sarif.yml` (upload-sarif) ja README-merkki. Testit validoivat tuloksen OASISin SARIF-skeemaa vasten.

### Muutettu

- Kun HTTP-palvelin torjuu yhteyden tilalla 401 tai 403, `CONNECT_FAILED`-viesti nimeää tilan ja antaa vihjeen jatkotoimista (`--bearer-env`, `--auth`). Estoa ei yritetä kiertää.
- `--auth` ei enää väitä kirjautumisen olevan tarpeeton, kun palvelin vastaa 403: uusi huomio `AUTH_FORBIDDEN` kertoo eston.
- JSON-ulostulo muuttuu: uusi tunnus `AUTH_FORBIDDEN` korvaa 403-tilassa tunnuksen `AUTH_NOT_REQUIRED`. Jos käsittelet `--auth --json` -ulostuloa koneellisesti, päivitä tunnuksen tarkistus.

## [0.5.0] - 2026-11-02

### Lisätty

- Tokenimittari: raportti kertoo, montako tokenia palvelimen työkalumäärittelyt (nimi, kuvaus, syöteskeema) vievät arviolta mallin kontekstista jokaisessa pyynnössä, yhteensä ja kolme suurinta työkalua. JSON-raportissa kenttä `tokens` (`total`, `perTool`, `budget`, `method`). Arvio on merkit / 4, eli suuntaa antava (noin ±25 % mallin tokenisoijasta riippuen).
- `--max-tokens <luku>` ja actionin syöte `max-tokens`: CI-raja työkalumäärittelyjen arvioidulle yhteiskoolle. Ylitys on virhe `TOOLS_TOKEN_BUDGET_EXCEEDED`, ja viestissä ovat suurimmat työkalut.
- `--auth`: HTTP-palvelimen OAuth-tarkistus MCP:n valtuutusmäärittelyn mukaan. Kirjautumaton initialize-pyyntö (odotetaan 401 ja `WWW-Authenticate: Bearer` + `resource_metadata`), suojatun resurssin metatiedot (RFC 9728, `resource` ja `authorization_servers`) sekä valtuutuspalvelimen metatiedot (RFC 8414 tai OpenID Connect): `authorization_endpoint`, `token_endpoint`, PKCE `S256`, `refresh_token`-myöntö, asiakkaan rekisteröinti ja https. Uudet löydökset `AUTH_*`. Tarkistus ei lähetä tunnuksia; se tekee kirjautumattomia GET-pyyntöjä myös palvelimen ilmoittamalle valtuutuspalvelimelle. Peruste: kysynnän kartoitus 2.11.2026, Claude Coden OAuth-ongelmat (esim. vanheneva yhteys ilman refresh_tokenia).
- `TOOL_TOKENS_HIGH` (huomio): yksittäisen työkalun määrittely vie arviolta yli 1 000 tokenia. Huomio ei kaada `--strict`-ajoja.

### Muutettu

- `README.md` on nyt englanniksi (Marketplace-sivu näyttää sen). Aiempi suomenkielinen README siirrettiin sellaisenaan tiedostoon `README.fi.md`, johon lisättiin vain linkki englanninkieliseen versioon.

### Korjattu

- `--auth` ilman tokenia ei enää kaada kunnossa olevia OAuth-palvelimia. Kun palvelin vastaa 401 ja tarkistus ei saa tokenia (`--bearer-env`), kirjautumaton yhteysyritys ei ole vika. Yhteysvirhe `CONNECT_FAILED` muuttuu huomioksi `AUTH_LOGIN_REQUIRED`. Aiemmin 11 palvelinta 12:sta sai väärän virheen. Puuttuva `resource_metadata` (`AUTH_RESOURCE_METADATA_MISSING`) pysyy virheenä, koska MCP-määrittely edellyttää RFC 9728:aa.

## [0.4.1] - 2026-11-02

### Lisätty

- GitHub Marketplace -julkaisu: Action on julkaistu nimellä "MCP Doctor Health Check" (branding, kuvaus alle 125 merkkiä).

### Korjattu

- `action.yml`: `description`-arvon lainaamaton kaksoispiste rikkoi YAML:n ja kaatoi CI:n (#18). Arvo on nyt lainausmerkeissä.
- `action.yml`: nimi on "MCP Doctor Health Check", koska "MCP Doctor" oli Marketplacessa varattu (#19).

### Muutettu

- `test/action.test.ts` lukee `action.yml`:n `yaml`-paketilla rivipohjaisen luvun sijaan, ja uusi testi kaatuu lainaamattomaan `: `-yhdistelmään.
- README, `examples/workflow.yml`, `docs/ci.md` ja `docs/demo.md` viittaavat Actioniin muodossa `@v0.4.1`.

## [0.4.0] - 2026-11-01

### Lisätty

- Syöteskeeman tarkistus laskeutuu sisäkkäisiin objekteihin ja taulukon alkioihin (8 tasoon asti, `$ref`-viittauksia ei seurata). Löydösviestissä on kentän polku, esim. `entities[].name` tai `opts.depth`.
- `SCHEMA_ARRAY_ITEMS_MISSING` (varoitus): taulukkokentältä puuttuu `items`. Osa asiakkaista (esim. Gemini, OpenAI:n strict-tila) hylkää tällaisen skeeman ja samalla koko työkalun.
- `SCHEMA_NESTED_DESC_MISSING` ja `SCHEMA_NESTED_PROP_UNTYPED` (huomio): sisäkkäisen kentän puuttuva kuvaus tai tyyppi. Ne ovat huomioita, joten `--strict`-ajot eivät kaadu niihin.
- Demo-ohje [`docs/demo.md`](docs/demo.md) (suomi + englanti): pieni muistiinpanopalvelin ennen (`examples/demo/ennen.mjs`, viisi tyypillistä vikaa) ja jälkeen korjausten (`examples/demo/jalkeen.mjs`), savuajotiedosto ja skriptit `npm run demo:ennen` / `npm run demo:jalkeen`.
- Testi `test/demo.test.ts` ajaa demon jokaisessa CI-ajossa, joten ohjeen tuloste ei vanhene huomaamatta.
- Syöteskeeman tarkistus laskeutuu myös `anyOf`/`oneOf`/`allOf`-haaroihin ja tuple-muotoisiin taulukoihin (`items`-taulukko tai `prefixItems`). Esim. nullable-taulukko `anyOf: [{"type": "array"}, {"type": "null"}]` ilman `items`-määrittelyä saa nyt `SCHEMA_ARRAY_ITEMS_MISSING`-varoituksen (polku `x.anyOf[0]`). Haaroilta ei vaadita omaa kuvausta, ja haaran `required` saa viitata vanhemman kenttiin (`anyOf: [{"required": ["a"]}, {"required": ["b"]}]`). Katselmointi 31.10.2026, löydös 2.

### Muutettu

- Sisäkkäisen objektin rikkinäinen `required` raportoidaan samoin kuin ylätasolla (`SCHEMA_REQUIRED_INVALID` / `SCHEMA_REQUIRED_UNKNOWN`, virhe). Aiemmin sisäkkäisiä skeemoja ei tarkistettu lainkaan, joten palvelin, joka meni ennen läpi, voi nyt saada virheen tai (`--strict`) items-varoituksen.

### Korjattu

- Turvallisuus: stdio-komennon salaiselta näyttävät argumentit peitetään raportin kohderiviltä (teksti ja JSON). Esim. `--token xyz` -> `--token ***`, `--api-key=xyz`, `GITHUB_TOKEN=xyz` ja URL:n tunnukset ja kyselyparametrit (`https://***@host/x?***`). Palvelin käynnistetään edelleen alkuperäisillä argumenteilla. Aiemmin komentoriville annettu token päätyi CI-lokiin, vaikka HTTP-polussa kyselyparametrit jo jätettiin pois.
- Odottamattoman virheen viesti siivotaan ja lyhennetään kuten muu palvelimelta tuleva teksti, joten se ei voi aloittaa uutta riviä (esim. `::warning::`) eikä lähettää escape-sekvenssejä.
- README: testimäärä päivitetty (128).

## [0.3.0] - 2026-10-19

Korjaukset yöjonon koodikatselmoinnin (19.10.2026) löydöksistä.

### Korjattu

- Turvallisuus: palvelimelta tuleva teksti (palvelimen nimi ja versio, työkalun nimi, löydösviestit) siivotaan ennen tekstitulostetta. Ohjausmerkit ja rivinvaihdot poistetaan, joten haitallinen palvelin ei voi lisätä tulosteeseen GitHub Actionsin työnkulkukomentoja (`::warning::`, `::stop-commands::`) eikä lähettää terminaalille escape-sekvenssejä. JSON-tuloste oli jo turvallinen.
- `expectError: true` hyväksyy nyt myös JSON-RPC-virheen (esim. `-32602 Invalid params`), ei vain `isError`-vastausta. Aikakatkaisu ja katkennut yhteys eivät silti kelpaa odotettuna virheenä. Tilanne näkyy huomiona `SMOKE_EXPECTED_PROTOCOL_ERROR`.
- `required`-tarkistus ei enää huomauta kentistä, jotka voivat tulla `allOf`/`anyOf`/`oneOf`/`$ref`-rakenteen kautta, eikä pidä perittyjä avaimia (kuten `constructor`) kenttinä. Boolean-skeema (`true`/`false`) kentän määrittelynä ei enää anna varoitusta.
- Tyhjä savuajotiedosto (`{"calls": []}`) on käyttövirhe: se raportoisi OK, vaikka mitään ei testattu.
- Jos työkalulistaa ei saatu (kyky puuttuu tai `tools/list` epäonnistui), `SMOKE_TOOL_NOT_FOUND` kertoo sen eikä väitä, ettei työkalua ole.
- Toistuva `nextCursor` tunnistetaan (`TOOLS_PAGINATION_LOOP`) eikä listausta ajeta 50 sivun rajaan asti.
- Action: `env-names`-syöte ei laajene tiedostonimiksi; `command`-syötteen lainausmerkkirajoitus on dokumentoitu.

### Muutettu

- Odottamaton sisäinen virhe palauttaa poistumiskoodin `3` (aiemmin `2`, joka tarkoittaa käyttövirhettä), jotta CI erottaa työkalun oman vian väärästä komennosta.

### Lisätty

- Varoitus, kun `--bearer-env` lähettää tokenin salaamattomalla `http:`-yhteydellä muuhun kuin localhost-osoitteeseen.

## [0.2.0] - 2026-10-16

Ensimmäinen npm-julkaisu: `@tonyweckstrom/mcp-doctor`.

### Lisätty

- Julkaisu npm:ään scopattuna nimellä (nimi `mcp-doctor` oli jo toisen käytössä). `npx @tonyweckstrom/mcp-doctor` toimii ilman asennusta; komento on edelleen `mcp-doctor`.
- `--version`-valinta.
- Julkaisutiedot `package.json`:iin (repository, homepage, bugs, keywords, `publishConfig`), `prepublishOnly`-tarkistus ja CI:n pakettitesti (npm pack, asennus puhtaaseen kansioon, ajo).
- README: npx-käyttö, esimerkkituloste virheellisestä palvelimesta ja osio "Vaihtoehtoja ja miksi tämä" (vertailu muihin MCP-testityökaluihin).

### Korjattu

- Asiakkaan ilmoittama versio luetaan nyt `package.json`:ista (oli kovakoodattu `0.1.0`). Testi varmistaa, että palvelin näkee oikean version.
- Palvelimen oma `--help` tai `--version` `--`-erottimen jälkeen ei enää laukaise mcp-doctorin omaa ohjetta.

## [0.1.0] - 2026-10-16

### Lisätty

- Ensimmäinen versio: initialize-kättely, työkalujen skeematarkistus, savuajo, GitHub Action.
