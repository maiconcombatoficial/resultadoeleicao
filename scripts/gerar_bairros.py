"""Gera dados<ano>/secoes/<cd>.json (votos por seção, com o bairro de cada local) e dados<ano>/bairros-<eleição>.json.

2026: python3 scripts/gerar_bairros.py --ano 2026 --turno 2 --pleito <cd>   (lê .cache/bu/<pleito>/*.bu)
2022: python3 scripts/gerar_bairros.py --ano 2022                          (só refaz bairros e índices)
Os votos de outros turnos já gravados nos arquivos de seções são mantidos.
"""
import argparse, collections, json, os, sys
from comum import CACHE, RAIZ, TSE, baixar_json, bairros_floripa, chave_nome, ler_bu, ler_locais

ap = argparse.ArgumentParser()
ap.add_argument('--ano', type=int, default=2026)
ap.add_argument('--turno', type=int, default=1)
ap.add_argument('--pleito', type=int)
a = ap.parse_args()
DIR = os.path.join(RAIZ, f'dados{a.ano}')
os.makedirs(os.path.join(DIR, 'secoes'), exist_ok=True)
FLORIPA = bairros_floripa(a.ano)
L, S, _ = ler_locais(a.ano, a.turno)
log = lambda *x: print(*x, file=sys.stderr, flush=True)

arquivos = {}
for f in os.listdir(os.path.join(DIR, 'secoes')):
    arquivos[f[:5]] = json.load(open(os.path.join(DIR, 'secoes', f)))
novos = set()  # eleições ('t<turno>-c<cargo>') geradas agora
if a.ano == 2026:
    pasta = os.path.join(CACHE, 'bu', str(a.pleito))
    comp = {}
    for f in sorted(os.listdir(pasta)):
        if not f.endswith('.bu'):
            continue
        o = ler_bu(os.path.join(pasta, f), a.turno)
        cd = o['mun']; z = str(o['zona']); zs = f"{z}-{o['secao']}"; k = f"{z}-{o['local']}"
        if (cd, k) not in L and (cd, zs) in S:
            k = S[(cd, zs)]
        arq = arquivos.setdefault(cd, {'locais': {}, 'secoes': {}, 'votos': {}})
        arq['secoes'].setdefault(zs, k)
        for el, arr in o['votos'].items():
            if el not in novos:  # zera a eleição na 1ª vez que aparece (regeração)
                for x in arquivos.values():
                    x['votos'].pop(el, None)
                novos.add(el)
            arq['votos'].setdefault(el, {})[zs] = arr
        comp[f'{cd}|{zs}'] = [o['aptos'], o['comp']]
    json.dump(comp, open(os.path.join(CACHE, f'comparecimento-t{a.turno}.json'), 'w'))
    log('boletins', len(comp), 'eleições', sorted(novos))
else:
    novos = {el for x in arquivos.values() for el in x['votos']}

# completa locais (nome, endereço, bairro) e grava
sem = 0
for cd, arq in arquivos.items():
    loc = {}
    for zs, k in list(arq['secoes'].items()):
        if (cd, k) not in L and (cd, zs) in S and L.get((cd, S[(cd, zs)])):
            k = arq['secoes'][zs] = S[(cd, zs)]
        info = L.get((cd, k))
        if info:
            loc[k] = info[:3]
            if cd == '81051' and FLORIPA.get(k):
                loc[k][2] = FLORIPA[k]
        else:
            antigo = arq['locais'].get(k)
            loc[k] = (antigo[:2] if antigo else ['Local ' + k, '']) + [antigo[2] if antigo and len(antigo) > 2 else '']
            sem += 1
    arq['locais'] = loc
    json.dump(arq, open(os.path.join(DIR, 'secoes', f'{cd}.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
log('municípios', len(arquivos), 'seções sem local no cadastro', sem)

# índice de bairros por candidato (só cargos estaduais/nacionais: em prefeito e vereador o número se repete
# entre municípios, e o app usa direto os arquivos de seções da cidade)
MUNICIPAL = lambda el: el.endswith(('c11', 'c13'))
bairro_id, bairros = {}, []
por_el = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))
validos_b = collections.defaultdict(collections.Counter)
for cd, arq in arquivos.items():
    for el, secs in arq['votos'].items():
        if el not in novos or MUNICIPAL(el):
            continue
        prop = el.endswith(('c6', 'c7', 'c13'))
        for zs, arr in secs.items():
            b = arq['locais'].get(arq['secoes'].get(zs), ['', '', ''])[2] or 'Bairro não informado'
            if (cd, b) not in bairro_id:
                bairro_id[(cd, b)] = len(bairros); bairros.append([cd, b])
            bi = bairro_id[(cd, b)]
            for i in range(0, len(arr), 2):
                nr, v = arr[i], arr[i + 1]
                if nr in (95, 96, 97):
                    continue
                validos_b[el][bi] += v
                if prop and nr < 100:
                    continue
                por_el[el][nr][bi] += v

# 2026: liga cada candidato à participação dele em 2022 (nome completo) e soma os votos de 2022 por bairro
liga, votos22 = {}, collections.defaultdict(collections.Counter)
if a.ano == 2026:
    r22 = json.load(open(os.path.join(RAIZ, 'dados2022', 'resumo.json')))
    idx22 = collections.defaultdict(list)
    for e in r22['eleicoes']:
        for x in e['candidatos']:
            idx22[chave_nome(x[3])].append((f"t{e['turno']}-c{e['cargo']}", e['turno'], e['cargo'], int(x[1])))
    pedidos = collections.defaultdict(set)
    for el in por_el:
        t, c = int(el[1]), int(el.split('-c')[1])
        ele = (6257 if c == 1 else 6259) + (t - 1)
        j = baixar_json(f'{TSE}/ele2026/{ele}/dados/sc/sc-c{c:04d}-e{ele:06d}-u.json')
        for cg in (j or {}).get('carg', []):
            for ag in cg['agr']:
                for pa in ag['par']:
                    for x in pa['cand']:
                        parts = idx22.get(chave_nome(x['nm']))
                        if not parts:
                            continue
                        p = next((q for q in parts if q[1] == t and q[2] == c), None) or next((q for q in parts if q[1] == 1 and q[2] == c), None) or next((q for q in parts if q[1] == 1), parts[0])
                        liga[(el, int(x['n']))] = p
                        pedidos[p[0]].add(p[3])
    D22 = os.path.join(RAIZ, 'dados2022', 'secoes')
    for f in os.listdir(D22):
        arq = json.load(open(os.path.join(D22, f))); cd = f[:5]
        for el22, nrs in pedidos.items():
            for zs, arr in arq['votos'].get(el22, {}).items():
                b = arq['locais'].get(arq['secoes'].get(zs), ['', '', ''])[2] or 'Bairro não informado'
                for i in range(0, len(arr), 2):
                    if arr[i] in nrs:
                        votos22[(el22, arr[i])][(cd, b)] += arr[i + 1]
    log('ligados a 2022', len(liga))

for el, cands in por_el.items():
    vb = validos_b[el]
    usados, c_out = set(), {}
    for nr, cnt in cands.items():
        ordem = lambda bi: tuple(bairros[bi])  # desempate estável: município e bairro
        top_v = sorted(cnt.items(), key=lambda x: (-x[1], ordem(x[0])))[:15]
        pcts = sorted(((v / vb[bi], bi, v) for bi, v in cnt.items() if vb[bi] >= 300), key=lambda x: (-x[0], ordem(x[1])))[:10]
        c_out[nr] = {'v': [[bi, v] for bi, v in top_v], 'p': [[bi, v] for _, bi, v in pcts], 'n': len(cnt)}
        usados.update(bi for bi, _ in top_v); usados.update(bi for _, bi, _ in pcts)
        lg = liga.get((el, nr))
        if lg:
            v22 = votos22[(lg[0], lg[3])]
            ks = {bairro_id[k] for k in v22 if k in bairro_id} | set(cnt)
            deltas = [(cnt.get(bi, 0) - v22.get(tuple(bairros[bi]), 0), bi) for bi in ks]
            up = [bi for d, bi in sorted(deltas, key=lambda x: (-x[0], ordem(x[1])))[:10] if d > 0]
            dn = [bi for d, bi in sorted(deltas, key=lambda x: (x[0], ordem(x[1])))[:10] if d < 0]
            c_out[nr]['up'] = [[bi, cnt.get(bi, 0)] for bi in up]
            c_out[nr]['dn'] = [[bi, cnt.get(bi, 0)] for bi in dn]
            usados.update(up); usados.update(dn)
    remap = {bi: i for i, bi in enumerate(sorted(usados))}
    c_fin = {}
    for nr, d in c_out.items():
        lg = liga.get((el, nr))
        v22 = votos22[(lg[0], lg[3])] if lg else None
        conv = lambda x: [[remap[bi], v] + ([v22.get(tuple(bairros[bi]), 0)] if v22 is not None else []) for bi, v in x]
        e = {k: conv(d[k]) for k in ('v', 'p', 'up', 'dn') if k in d}
        e['n'] = d['n']
        if lg:
            agora = {tuple(bairros[bi]): v for bi, v in cands[nr].items()}
            ks = set(agora) | set(v22)
            e['e22'] = lg[0]; e['n22'] = lg[3]
            e['s'] = [sum(1 for k in ks if agora.get(k, 0) > v22.get(k, 0)), sum(1 for k in ks if agora.get(k, 0) < v22.get(k, 0))]
        c_fin[nr] = e
    out = {'b': [bairros[bi] + [vb[bi]] for bi in sorted(usados)], 'c': c_fin}
    json.dump(out, open(os.path.join(DIR, f'bairros-{el}.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    log(el, 'candidatos', len(c_fin), 'bairros', len(remap))

# votos de cada candidato por município (para a ficha: "por município" em SC inteira)
for el in novos:
    if MUNICIPAL(el):
        continue
    prop = el.endswith(('c6', 'c7', 'c13'))
    validos, cand = collections.Counter(), collections.defaultdict(collections.Counter)
    for cd, arq in arquivos.items():
        for zs, arr in arq['votos'].get(el, {}).items():
            for i in range(0, len(arr), 2):
                nr, v = arr[i], arr[i + 1]
                if nr in (95, 96, 97):
                    continue
                validos[cd] += v
                if prop and nr < 100:
                    continue
                cand[nr][cd] += v
    json.dump({'validos': validos, 'c': cand}, open(os.path.join(DIR, f'municipios-{el}.json'), 'w'), separators=(',', ':'))
    log('municípios', el, len(cand))

# índice das eleições com dados por seção
ids = sorted({f[8:-5] for f in os.listdir(DIR) if f.startswith('bairros-') and f.endswith('.json')} | {el for el in novos if MUNICIPAL(el)})
json.dump({'eleicoes': ids}, open(os.path.join(DIR, 'indice.json'), 'w'))
log('índice', ids)
