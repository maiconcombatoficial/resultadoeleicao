"""Gera dados2026/locais-mapa.json: coordenadas de cada local de votação de SC (cadastro de locais do TSE, dado público).

Formato: {"<cd município>": {"<zona>-<local>": [lat, lon]}}. Usado pelo mapa de votos aberto da ficha do candidato.
Uso: python3 scripts/gerar_locais_mapa.py
"""
import json, os, sys
from comum import RAIZ, ler_locais

L, _, _ = ler_locais(2026, 1)
num = lambda s: round(float(s.replace(',', '.')), 5) if s and s not in ('-1', '#NULO#', '') else None
out, sem = {}, 0
for (cd, k), (_, _, _, lat, lon) in L.items():
    la, lo = num(lat), num(lon)
    if la is None or lo is None or not (-30 < la < -25 and -54.5 < lo < -48):  # fora de SC: descarta
        sem += 1
        continue
    out.setdefault(cd, {})[k] = [la, lo]
json.dump(out, open(os.path.join(RAIZ, 'dados2026', 'locais-mapa.json'), 'w'), separators=(',', ':'))
print('municípios', len(out), 'locais', sum(len(v) for v in out.values()), 'sem coordenada', sem, file=sys.stderr)
