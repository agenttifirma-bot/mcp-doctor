/**
 * Peittää stdio-komennon argumenteista salaisuudelta näyttävät arvot ennen kuin komento tulostuu
 * raporttiin (teksti, JSON, CI-loki). Komento itse käynnistetään aina alkuperäisillä argumenteilla.
 *
 * Peitetään:
 *  - salaiselta kuulostavan lipun arvo: `--token xyz`, `--api-key=xyz` (vain pitkät liput: lyhyet kuten `-p` ovat monitulkintaisia)
 *  - ympäristömuuttujamuotoinen sijoitus: `API_KEY=xyz` (esim. `env API_KEY=xyz node server.js`)
 *  - URL:n käyttäjätunnus/salasana ja kyselyparametrit: `https://u:p@host/x?key=1` -> `https://***@host/x?***`
 */
const SECRET_NAME = /(token|secret|passw(or)?d|passwd|pwd|api[-_]?key|apikey|access[-_]?key|private[-_]?key|client[-_]?secret|auth|credential|bearer|cookie|session)/i;
const MASK = "***";

function looksSecret(name: string): boolean {
  return SECRET_NAME.test(name);
}

function maskUrl(arg: string): string {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(arg)) return arg;
  let u: URL;
  try {
    u = new URL(arg);
  } catch {
    return arg;
  }
  if (!u.username && !u.password && !u.search) return arg;
  const auth = u.username || u.password ? `${MASK}@` : "";
  const query = u.search ? `?${MASK}` : "";
  return `${u.protocol}//${auth}${u.host}${u.pathname}${query}${u.hash}`;
}

export function redactArgs(argv: readonly string[]): string[] {
  const out: string[] = [];
  let maskNext = false;
  for (const arg of argv) {
    if (maskNext) {
      out.push(MASK);
      maskNext = false;
      continue;
    }
    const long = /^(--?[A-Za-z][\w.-]*)(=(.*))?$/s.exec(arg);
    if (long && long[1].startsWith("--") && looksSecret(long[1])) {
      if (long[2] !== undefined) out.push(`${long[1]}=${MASK}`);
      else {
        out.push(arg);
        maskNext = true;
      }
      continue;
    }
    const assign = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(arg);
    if (assign && looksSecret(assign[1])) {
      out.push(`${assign[1]}=${MASK}`);
      continue;
    }
    out.push(maskUrl(arg));
  }
  return out;
}

/** Lyhyempiä arvoja ei peitetä: `1`, `true` tai `prod` peittäminen sotkisi raportin eikä suojaisi mitään. */
export const MIN_SECRET_LENGTH = 8;

/**
 * Peittää tunnetut salaiset arvot (--env:llä välitetyt arvot ja --bearer-env-token) valmiista tulosteesta.
 * Palvelin voi tulostaa saamansa arvon stderriin ("virheellinen avain sk-…") tai virheviestiinsä, ja
 * se päätyisi muuten raporttiin ja CI-lokiin. Peitetään sekä raaka muoto että JSON-merkkijonon muoto.
 */
export function maskSecrets(text: string, secrets: readonly string[]): string {
  const forms = new Set<string>();
  for (const s of secrets) {
    if (s.length < MIN_SECRET_LENGTH) continue;
    forms.add(s);
    forms.add(JSON.stringify(s).slice(1, -1));
  }
  let out = text;
  for (const f of [...forms].sort((a, b) => b.length - a.length)) {
    out = out.split(f).join(MASK);
    // Lyhennetty viesti (300 merkkiä + "…") voi katkaista arvon kesken: peitetään myös katkennut alkuosa.
    for (let k = f.length - 1; k >= 4; k--) out = out.split(`${f.slice(0, k)}…`).join(`${MASK}…`);
  }
  return out;
}
