#!/usr/bin/env python3
"""Extrai os resultados do 2º turno no exterior da página do g1.

Gera data/results.json. Só sobrescreve o arquivo quando o parsing é
considerado válido; em caso de falha, sai com código != 0 e preserva a
última versão boa.
"""

from __future__ import annotations

import html
import http.client
import json
import re
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SOURCE_URL = (
    "https://g1.globo.com/mundo/noticia/2026/10/25/"
    "votacao-no-exterior-confira-os-resultados-do-2o-turno-entre-lula-e-flavio-bolsonaro.ghtml"
)
OUT_PATH = Path(__file__).resolve().parent.parent / "data" / "results.json"
MIN_COUNTRIES = 50  # sanidade: a página lista mais de cem países

SECTIONS = {
    "OCEANIA E ÁSIA": "Oceania e Ásia",
    "EUROPA": "Europa",
    "AMÉRICA": "América",
    "ÁFRICA": "África",
}

TURNO_RE = re.compile(r"^(2|1)º turno:\s*(.+)$", re.S)
VOTE_RE = re.compile(
    r"^(Lula|Flávio(?: Bolsonaro)?),\s*([\d.]+)\s*votos?"
    r"(?:\s*\(([\d,]+)\s*%\))?$"
)
PENDING = "ainda não há dados disponíveis"


def fetch(url: str, attempts: int = 3) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
            ),
            "Accept-Language": "pt-BR,pt;q=0.9",
        },
    )
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                return resp.read().decode("utf-8", "replace")
        except (OSError, http.client.HTTPException) as exc:
            last = exc
            if attempt + 1 < attempts:
                time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"falha ao baixar a página: {last}")


def strip_tags(fragment: str) -> str:
    text = re.sub(r"<[^>]+>", "", fragment)
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def to_int(raw: str) -> int:
    return int(raw.replace(".", ""))


def to_pct(raw: str | None) -> float | None:
    return round(float(raw.replace(",", ".")), 2) if raw else None


def parse(html_text: str) -> dict:
    start = html_text.find("<article")
    if start == -1:
        raise RuntimeError("artigo não encontrado na página")
    article = html_text[start:]
    chunks = article.split('<div id="chunk-')[1:]

    sections: dict[str, list[dict]] = {}
    section = None

    for i, chunk in enumerate(chunks):
        heading = re.search(r"<h2>(.*?)</h2>", chunk, re.S)
        if not heading:
            continue
        name = strip_tags(heading.group(1))
        if not name or name.upper() == name:
            section = SECTIONS.get(name.upper(), name.title())
            continue

        # A lista de votos fica no(s) chunk(s) logo após o título.
        lines: list[str] = []
        for nxt in chunks[i + 1 : i + 4]:
            ul = re.search(
                r'<ul class="content-unordered-list">(.*?)</ul>', nxt, re.S
            )
            if ul:
                lines = [
                    strip_tags(li)
                    for li in re.findall(r"<li>(.*?)</li>", ul.group(1), re.S)
                ]
                break
        if not lines or not any("turno" in line for line in lines):
            continue  # título de outro conteúdo, não um país

        section = section or "Outros"

        lula = flavio = 0
        lula_pct = flavio_pct = None
        has_data = False

        for line in lines:
            m = TURNO_RE.match(line)
            if not m or m.group(1) != "2":
                continue
            body = m.group(2).strip()
            if body.startswith(PENDING):
                continue
            v = VOTE_RE.match(body)
            if not v:
                raise RuntimeError(f"linha não reconhecida em {name!r}: {body!r}")
            votes = to_int(v.group(2))
            pct = to_pct(v.group(3))
            if v.group(1).startswith("Lula"):
                lula, lula_pct = votes, pct
            else:
                flavio, flavio_pct = votes, pct
            has_data = True

        if not has_data:
            entry = {
                "name": name,
                "section": section,
                "has_data": False,
                "lula_votes": None,
                "flavio_votes": None,
                "lula_pct": None,
                "flavio_pct": None,
                "lula_pct_published": False,
                "flavio_pct_published": False,
                "winner": None,
            }
        else:
            valid = lula + flavio
            lula_calc = round(lula * 100 / valid, 2) if valid else 0.0
            flavio_calc = round(flavio * 100 / valid, 2) if valid else 0.0
            entry = {
                "name": name,
                "section": section,
                "has_data": True,
                "lula_votes": lula,
                "flavio_votes": flavio,
                "lula_pct": lula_pct if lula_pct is not None else lula_calc,
                "flavio_pct": (
                    flavio_pct if flavio_pct is not None else flavio_calc
                ),
                "lula_pct_published": lula_pct is not None,
                "flavio_pct_published": flavio_pct is not None,
                "winner": (
                    "lula" if lula > flavio else "flavio" if flavio > lula else "tie"
                ),
            }
        sections.setdefault(section, []).append(entry)

    countries = [c for group in sections.values() for c in group]
    if len(countries) < MIN_COUNTRIES:
        raise RuntimeError(
            f"apenas {len(countries)} países reconhecidos (mínimo {MIN_COUNTRIES})"
        )

    reporting = [c for c in countries if c["has_data"]]
    lula_total = sum(c["lula_votes"] for c in reporting)
    flavio_total = sum(c["flavio_votes"] for c in reporting)
    valid_total = lula_total + flavio_total

    modified = re.search(r'MODIFIED:\s*"([^"]+)"', html_text)

    return {
        "generated_at": datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
        "source_url": SOURCE_URL,
        "source_updated_at": modified.group(1) if modified else None,
        "totals": {
            "lula_votes": lula_total,
            "flavio_votes": flavio_total,
            "valid_votes": valid_total,
            "lula_pct": round(lula_total * 100 / valid_total, 2) if valid_total else 0,
            "flavio_pct": (
                round(flavio_total * 100 / valid_total, 2) if valid_total else 0
            ),
            "leader": (
                "lula"
                if lula_total > flavio_total
                else "flavio" if flavio_total > lula_total else "tie"
            ),
            "countries_total": len(countries),
            "countries_reporting": len(reporting),
            "countries_pending": len(countries) - len(reporting),
            "countries_lula": sum(1 for c in reporting if c["winner"] == "lula"),
            "countries_flavio": sum(1 for c in reporting if c["winner"] == "flavio"),
            "countries_tie": sum(1 for c in reporting if c["winner"] == "tie"),
        },
        "sections": [
            {"name": name, "countries": group}
            for name, group in sections.items()
        ],
    }


def main() -> int:
    try:
        data = parse(fetch(SOURCE_URL))
    except Exception as exc:  # noqa: BLE001 - falha explícita para o CI
        print(f"erro: {exc}", file=sys.stderr)
        return 1

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=OUT_PATH.parent, delete=False
    ) as tmp:
        json.dump(data, tmp, ensure_ascii=False, indent=2)
        tmp.write("\n")
        tmp_path = Path(tmp.name)
    tmp_path.replace(OUT_PATH)

    t = data["totals"]
    print(
        f"ok: {t['countries_total']} países, {t['countries_reporting']} com dados | "
        f"Lula {t['lula_votes']} ({t['lula_pct']}%) x "
        f"Flávio {t['flavio_votes']} ({t['flavio_pct']}%)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
