#!/usr/bin/env python3
"""Indica se data/results.json mudou de forma relevante em relação ao HEAD.

`generated_at` muda a cada coleta, então é ignorado na comparação para não
gerar um commit a cada 20 minutos quando os votos seguem iguais.

Saída: 0 quando há mudança relevante (ou o arquivo ainda não está no HEAD),
1 quando só o horário de coleta mudou.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "results.json"


def normalized(data: dict) -> dict:
    data = dict(data)
    data.pop("generated_at", None)
    return data


def head_data() -> dict | None:
    try:
        raw = subprocess.check_output(
            ["git", "show", "HEAD:data/results.json"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None
    return json.loads(raw)


def main() -> int:
    current = json.loads(OUT.read_text(encoding="utf-8"))
    previous = head_data()
    if previous is None:
        return 0
    return 0 if normalized(current) != normalized(previous) else 1


if __name__ == "__main__":
    raise SystemExit(main())
