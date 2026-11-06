"""Automaattinen yhdistaminen, versio 2 (Tonyn paatos 4.11.2026: "kaikki paitsi rajatut").

Ajetaan GitHub Actionsissa (pull_request_target ja issue_comment, luotettu koodi paahaarasta; PR:n omaa koodia
ei koskaan ladata eika suoriteta). Paatos tehdaan vain PR:n metatiedoista, tiedostolistasta, patch-teksteista
ja riippumattoman tarkastajan kommentista.

Auto-merge kytketaan vain kun KAIKKI ehdot tayttyvat:
  - PR ei ole luonnos, base on main tai master, eika siina ole tunnistetta 'ei-automerge'
  - PR on saman repon haarasta TAI botin omasta forkista (tekija BOTTI, head-repo BOTTI/<sama repo>, haara yo/<nimi>)
  - enintaan MAX_TIEDOSTOA tiedostoa ja MAX_RIVEJA muutettua rivia
  - repo ei ole rajattu (RAJATUT_REPOT) eika mikaan tiedosto (uusi tai vanha nimi) osu rajattuun luokkaan:
    tyonkulut (.github), automerge itse, oikeudet, kulukatot, palomuuri, salaisuudet, oikea raha (kauppatiimi),
    julkaistu Action; poistot ja uudelleennimeamiset ovat sallittuja muualla
  - jokaisesta tiedostosta on patch, eika lisatyilla riveilla ole yksityista IP-osoitetta tai tailnet-nimea
  - riippumaton tarkastaja (TARKASTAJAT, claudejono.tarkastaja isannalla) on hyvaksynyt TAMAN head-commitin:
    viimeisin tarkastajan kommentti, jonka merkki koskee head-SHA:ta, on paatos HYVAKSYTTY
Silloin kytketaan GitHubin auto-merge (squash, --match-head-commit): yhdistyy vasta kun pakolliset tarkistukset ovat
lapi, ja vain jos head on yha sama commit. Jos PR ei (enaa) kelpaa, auto-merge poistetaan.
Rajatut yhdistaa aina Tony. Kaikki yhdistetyt nakyvat aamukoosteessa, ja Tony voi perua (revert).
"""
import json
import os
import re
import subprocess
import sys

MAX_TIEDOSTOA = 60
MAX_RIVEJA = 1500
OPT_OUT = "ei-automerge"
BOTTI = "agenttifirma-bot"
# Tarkastajan kommentin saa kirjoittaa vain botin tunnus, jota agentit eivat nae (tunnus on vain prbotilla ja rootilla).
TARKASTAJAT = (BOTTI,)
BOTIN_HAARA = re.compile(r"^yo/[a-z0-9][a-z0-9._-]{0,59}\Z")
TARKASTUS_RE = re.compile(r"<!-- riippumaton-tarkastus v1 sha=([0-9a-f]{40}) paatos=(HYVAKSYTTY|HYLATTY|RAJATTU|EN_TIEDA) -->")
NIMI_OK = re.compile(r"^[A-Za-z0-9_./@+-]+\Z")

# Koko repo Tonylle (julkaisu Tonyn nimissa tai Tonyn paatokset).
RAJATUT_REPOT = {
    "tonyweckstrom1987.github.io": "julkaisu Tonyn nimissa (portfolio)",
    "agenttifirma-docs": "Tonyn paatokset (docs-repo)",
}
# (saanto, luokka). Saanto osuu, jos se loytyy polusta (search).
RAJATUT = [
    (re.compile(r"^\.github/"), "tyonkulut (.github)"),
    (re.compile(r"^tools/automerge\.py\Z"), "automergen saannot"),
    (re.compile(r"(^|/)(pr_kutsu|github_app)\.py\Z"), "oikeudet"),
    (re.compile(r"(^|/)(claudejono-pr|asenna-kayttaja\.sh)\Z"), "oikeudet"),
    (re.compile(r"(^|/)sudoers"), "oikeudet"),
    (re.compile(r"(^|/)(rajat|config)\.py\Z"), "kulukatot ja rajat"),
    (re.compile(r"^claudejono/varaus\.py\Z"), "kulukatot (Tonyn varaus)"),
    (re.compile(r"^yojono/(?!test_[a-z0-9_]+\.py\Z)"), "kulukatot (yojono)"),
    (re.compile(r"(nftables|iptables|ufw|palomuuri|firewall)", re.IGNORECASE), "palomuuri"),
    (re.compile(r"(^|/)\.env|secret|token|credential|password|api_?key|private_?key|\.pem\Z|\.key\Z|id_(rsa|ed25519)",
                re.IGNORECASE), "salaisuudet"),
    (re.compile(r"^action\.ya?ml\Z|^dist/"), "julkaistu Action"),
    (re.compile(r"(^|/)\.\.(/|\Z)|^/"), "polku"),
]
# Repokohtaiset lisarajaukset. kauppatiimi: oikean rahan lukot (sama kuin agentti/pr_kutsu.REPON_SUOJATUT).
REPON_RAJATUT = {
    "kauppatiimi": [(re.compile(r"(^|/)(riskivahti\.py|salkku\.py|kirjanpito\.py|asetukset\.py|rajat\.py|config\.py)\Z|\.(service|timer|db|sqlite3?)\Z|^data/"),
                     "oikea raha")],
}
# Lisatyilla riveilla ei saa olla infran osoitteita (julkiset repot).
OSOITE_RE = re.compile(r"\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b|\b[a-z0-9-]+\.ts\.net\b|\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b",
                       re.IGNORECASE)


def rajattu(repo_nimi, polku):
    """Rajatun luokan nimi tai None. repo_nimi ilman omistajaa (esim. 'kauppatiimi')."""
    if not polku or not NIMI_OK.match(polku):
        return "polku"
    for saanto, luokka in RAJATUT + REPON_RAJATUT.get(repo_nimi, []):
        if saanto.search(polku):
            return luokka
    return None


def tarkastajan_paatos(kommentit, sha):
    """Viimeisin tarkastajan paatos annetulle head-SHA:lle tai None. kommentit: [{'user', 'body'}] aikajarjestyksessa."""
    paatos = None
    for k in kommentit or []:
        if (k.get("user") or "") not in TARKASTAJAT:
            continue
        merkit = TARKASTUS_RE.findall(k.get("body") or "")
        if len(merkit) != 1:
            continue                                   # tasan yksi merkki per kommentti (mallin tekstiin upotettu merkki ei kelpaa)
        if merkit[0][0] == sha:
            paatos = merkit[0][1]
    return paatos


def _lisatyt_rivit(patch):
    return [r[1:] for r in (patch or "").splitlines() if r.startswith("+") and not r.startswith("+++")]


def botin_forkki_syyt(pr):
    base = pr.get("base_repo") or ""
    nimi = base.split("/", 1)[1] if "/" in base else ""
    syyt = []
    if (pr.get("author") or "").lower() != BOTTI:
        syyt.append("forkista vain botin PR")
    elif not nimi or (pr.get("head_repo") or "").lower() != f"{BOTTI}/{nimi}".lower():
        syyt.append("forkki ei ole botin oma fork samasta reposta")
    if not BOTIN_HAARA.match(pr.get("head_ref") or ""):
        syyt.append("botin haaran nimi ei ole yo/<nimi>")
    return syyt


def rakenne_syyt(pr, tiedostot):
    """Kaikki muut ehdot kuin tarkastajan hyvaksynta. Palauttaa syyt (tyhja = ok). Tata kayttaa myos isannan tarkastaja
    (claudejono.tarkastaja) paattaessaan, kannattaako PR tarkastaa."""
    syyt = []
    repo_nimi = (pr.get("base_repo") or "").split("/", 1)[-1]
    if pr.get("draft"):
        syyt.append("luonnos")
    if pr.get("base_ref") not in ("main", "master"):
        syyt.append("base ei ole main eika master")
    if OPT_OUT in (pr.get("labels") or []):
        syyt.append("tunniste " + OPT_OUT)
    if repo_nimi in RAJATUT_REPOT:
        syyt.append("rajattu repo: " + RAJATUT_REPOT[repo_nimi])
    if pr.get("head_repo") != pr.get("base_repo"):
        syyt.extend(botin_forkki_syyt(pr))
    if not tiedostot:
        syyt.append("ei tiedostoja")
    if len(tiedostot) > MAX_TIEDOSTOA:
        syyt.append("liian monta tiedostoa (%d)" % len(tiedostot))
    rivit = sum(int(t.get("changes") or 0) for t in tiedostot)
    if rivit > MAX_RIVEJA:
        syyt.append("liian suuri muutos (%d rivia)" % rivit)
    for t in tiedostot:
        for nimi in (t.get("filename"), t.get("previous_filename")):
            if nimi is None:
                continue
            luokka = rajattu(repo_nimi, nimi)
            if luokka:
                syy = "rajattu (%s): %s" % (luokka, nimi)
                if syy not in syyt:
                    syyt.append(syy)
        if t.get("patch") is None and int(t.get("changes") or 0) > 0:
            syyt.append("patch puuttuu (binaari tai liian suuri): %s" % t.get("filename"))
        elif any(OSOITE_RE.search(r) for r in _lisatyt_rivit(t.get("patch"))):
            syyt.append("lisatylla rivilla yksityinen osoite tai tailnet-nimi: %s" % t.get("filename"))
    return syyt


def arvioi(pr, tiedostot, kommentit=()):
    """(sallittu, syyt). pr: dict (draft, head_repo, base_repo, labels, author, head_ref, base_ref, head_sha)."""
    syyt = rakenne_syyt(pr, tiedostot)
    sha = pr.get("head_sha") or ""
    paatos = tarkastajan_paatos(kommentit, sha) if re.match(r"^[0-9a-f]{40}\Z", sha) else None
    if paatos != "HYVAKSYTTY":
        syyt.append("riippumaton tarkastus: " + ({None: "odottaa"}.get(paatos) or paatos))
    return (not syyt), syyt


def _gh(*args):
    return subprocess.run(["gh", *args], capture_output=True, text=True, timeout=120)


def hae_pr(repo, numero):
    r = _gh("api", "repos/%s/pulls/%s" % (repo, numero))
    if r.returncode != 0:
        raise RuntimeError("PR:n haku epaonnistui: " + r.stderr.strip()[-200:])
    d = json.loads(r.stdout)
    return {
        "draft": bool(d.get("draft")),
        "state": d.get("state"),
        "head_repo": ((d.get("head") or {}).get("repo") or {}).get("full_name"),
        "base_repo": ((d.get("base") or {}).get("repo") or {}).get("full_name"),
        "labels": [l.get("name") for l in d.get("labels", [])],
        "author": (d.get("user") or {}).get("login"),
        "head_ref": (d.get("head") or {}).get("ref"),
        "head_sha": (d.get("head") or {}).get("sha"),
        "base_ref": (d.get("base") or {}).get("ref"),
    }


def hae_tiedostot(repo, numero):
    r = _gh("api", "--paginate", "repos/%s/pulls/%s/files?per_page=100" % (repo, numero), "--jq", ".[]")
    if r.returncode != 0:
        raise RuntimeError("tiedostojen haku epaonnistui: " + r.stderr.strip()[-200:])
    return [json.loads(rivi) for rivi in r.stdout.splitlines() if rivi.strip()]


def hae_kommentit(repo, numero):
    r = _gh("api", "--paginate", "repos/%s/issues/%s/comments?per_page=100" % (repo, numero), "--jq",
            ".[] | {user: .user.login, body: .body}")
    if r.returncode != 0:
        raise RuntimeError("kommenttien haku epaonnistui: " + r.stderr.strip()[-200:])
    return [json.loads(rivi) for rivi in r.stdout.splitlines() if rivi.strip()]


def yhteenveto(teksti):
    polku = os.environ.get("GITHUB_STEP_SUMMARY")
    print(teksti)
    if polku:
        try:
            with open(polku, "a") as f:
                f.write(teksti + "\n")
        except OSError:
            pass


def main():
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    numero = os.environ.get("PR_NUMBER", "")
    if not re.match(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", repo) or not numero.isdigit():
        print("virheellinen GITHUB_REPOSITORY tai PR_NUMBER")
        return 2
    try:
        pr = hae_pr(repo, numero)
        if pr.get("state") not in (None, "open"):
            yhteenveto("Automerge: PR #%s ei ole auki, ei tehda mitaan" % numero)
            return 0
        sallittu, syyt = arvioi(pr, hae_tiedostot(repo, numero), hae_kommentit(repo, numero))
    except (RuntimeError, ValueError) as e:
        yhteenveto("Automerge: arviointi epaonnistui (%s), ei tehda mitaan" % e)
        return 1
    if sallittu:
        r = _gh("pr", "merge", numero, "--auto", "--squash", "--match-head-commit", pr["head_sha"], "--repo", repo)
        if r.returncode != 0:
            yhteenveto("Automerge: kytkenta epaonnistui: " + r.stderr.strip()[-200:])
            return 1
        yhteenveto("Automerge: PR #%s kelpaa (tarkastaja hyvaksyi %s). Yhdistyy kun tarkistukset ovat lapi." % (numero, pr["head_sha"][:7]))
        return 0
    _gh("pr", "merge", numero, "--disable-auto", "--repo", repo)
    yhteenveto("Automerge: PR #%s ei kelpaa automaattiseen yhdistamiseen: %s. Auto-merge poistettu." % (numero, "; ".join(syyt)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
