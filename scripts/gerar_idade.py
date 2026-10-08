"""Idade do eleitorado onde cada candidato teve votos (estimativa, área protegida 🔒).

Uso: PRO_CHAVE=<base64> python3 scripts/gerar_idade.py --ano 2024      (2012 a 2026; ou PRO_SENHA)

O TSE não publica em quem cada faixa etária votou (o voto é secreto). Publica o eleitorado de cada seção por
faixa etária (perfil_eleitor_secao_<ano>_SC). Cruzando os votos do candidato seção a seção (dados<ano>/secoes)
com a idade do eleitorado de cada seção, estima-se o perfil etário de onde ele vota. Grava, criptografado,
pro/idade-<ano>-<eleição>.bin:
  faixas  rótulos das 7 faixas
  b       % de cada faixa no eleitorado, ponderado pelos votos válidos: {'sc': [...]} ou, em prefeito e vereador,
          por município {cd: [...]}
  c       por candidato (número nas eleições gerais, SQ nas municipais): m = % de cada faixa nas seções onde
          votou (ponderado pelos votos dele), t = votos, qj/qi = % dos válidos dele em cada quinto das seções,
          da menor à maior presença de jovens (16 a 24) / de idosos (60+), quintos em SC ou na cidade
e pro/idade-secoes-<ano>.bin: eleitores de cada seção por faixa ({'s': {cd: {'zona-seção': [7]}}}), para a
lista de urnas da ficha mostrar o público de cada seção.
"""
import argparse, collections, csv, io, json, os, re, sys, zipfile
from comum import CACHE, CDN, RAIZ, baixar, ler_locais
from gerar_pro import gravar, obter_chave

FAIXAS = ['16 e 17 anos', '18 a 24 anos', '25 a 34 anos', '35 a 44 anos', '45 a 59 anos', '60 a 69 anos', '70 anos ou mais']
LIMITES = [18, 25, 35, 45, 60, 70]
JOVENS, IDOSOS = (0, 1), (5, 6)
log = lambda *x: print(*x, file=sys.stderr, flush=True)
csv.field_size_limit(1 << 24)


def faixa(desc):
    m = re.search(r'\d+', desc or '')
    if not m or int(m.group()) < 16:
        return None
    return sum(int(m.group()) >= l for l in LIMITES)


def perfil(ano):
    """(cd, 'zona-seção') -> eleitores por faixa (7)."""
    cache = os.path.join(CACHE, f'idade_secao_{ano}_SC.json')
    if os.path.exists(cache):
        return {tuple(k.split('|')): v for k, v in json.load(open(cache)).items()}
    nome = f'perfil_eleitor_secao_{ano}_SC'
    p = os.path.join(CACHE, 'tse', nome + '.zip')
    if not os.path.exists(p):
        os.makedirs(os.path.dirname(p), exist_ok=True)
        log('baixando', nome)
        open(p, 'wb').write(baixar(f'{CDN}/perfil_eleitor_secao/{nome}.zip', timeout=1800))
    z = zipfile.ZipFile(p)
    arq = [n for n in z.namelist() if n.endswith('.csv')][0]
    P = collections.defaultdict(lambda: [0] * 7)
    with z.open(arq) as f:
        for r in csv.DictReader(io.TextIOWrapper(f, encoding='latin1', newline=''), delimiter=';'):
            fx = faixa(r.get('DS_FAIXA_ETARIA'))
            if fx is None:
                continue
            q = int(r.get('QT_ELEITORES_PERFIL') or r.get('QT_ELEITORES') or 0)
            P[(r['CD_MUNICIPIO'].zfill(5), f"{int(r['NR_ZONA'])}-{int(r['NR_SECAO'])}")][fx] += q
    json.dump({f'{k[0]}|{k[1]}': v for k, v in P.items()}, open(cache, 'w'))
    return P


def quintos(itens):
    """itens: [(valor, peso)] -> quinto (0..4) de cada item, com pesos iguais por quinto."""
    tot = sum(w for _, w in itens) or 1
    g, acc = [0] * len(itens), 0
    for j in sorted(range(len(itens)), key=lambda j: itens[j][0]):
        g[j] = min(4, int(5 * acc / tot))
        acc += itens[j][1]
    return g


def gerar(ano, chave, so_secoes=False):
    D = os.path.join(RAIZ, f'dados{ano}')
    secoes = {f[:5]: json.load(open(os.path.join(D, 'secoes', f))) for f in os.listdir(os.path.join(D, 'secoes'))}
    if ano == 2026:
        els = json.load(open(os.path.join(D, 'indice.json')))['eleicoes']
        resumo = None
    else:
        resumo = json.load(open(os.path.join(D, 'resumo.json')))
        els = [f"t{e['turno']}-c{e['cargo']}" for e in resumo['eleicoes']]
    # seções agregadas votam na principal: o eleitorado delas vai para a principal
    try:
        _, _, princ = ler_locais(ano, 1)
    except Exception:
        princ = {}
    P = perfil(ano)
    perf = collections.defaultdict(lambda: [0] * 7)
    for (cd, zs), v in P.items():
        p = perf[(cd, princ.get((cd, zs), zs))]
        for i in range(7):
            p[i] += v[i]
    log(ano, 'eleitores no perfil', f'{sum(sum(v) for v in perf.values()):,}', 'seções', len(perf))
    # eleitorado de cada seção por faixa (para a lista de urnas da ficha): {cd: {'zona-seção': [7 faixas]}}
    por_cd = collections.defaultdict(dict)
    for (cd, zs), v in perf.items():
        if sum(v):
            por_cd[cd][zs] = v
    gravar(chave, f'idade-secoes-{ano}', {'ano': ano, 'faixas': FAIXAS, 's': por_cd})
    if so_secoes:
        return
    for el in els:
        cargo = int(el.split('-c')[1])
        municipal = cargo in (11, 13)
        prop = cargo in (6, 7, 13)
        # municipais: número -> SQ em cada cidade
        sq = {}
        if municipal:
            e = next(x for x in resumo['eleicoes'] if f"t{x['turno']}-c{x['cargo']}" == el)
            sq = {(x[8], int(x[1])): x[0] for x in e['candidatos']}
        sec, casadas, total = [], 0, 0
        for cd, arq in secoes.items():
            for zs, v in arq['votos'].get(el, {}).items():
                total += 1
                p = perf.get((cd, zs))
                n = sum(p) if p else 0
                if not n:
                    continue
                casadas += 1
                val, vs = 0, {}
                for i in range(0, len(v), 2):
                    nr, q = v[i], v[i + 1]
                    if nr in (95, 96, 97):
                        continue
                    val += q
                    if prop and nr < 100:
                        continue
                    k = sq.get((cd, nr)) if municipal else nr
                    if k is not None:
                        vs[k] = vs.get(k, 0) + q
                if val:
                    sh = [x / n for x in p]
                    sec.append({'esc': cd if municipal else 'sc', 'sh': sh, 'val': val, 'vs': vs,
                                'j': sum(sh[i] for i in JOVENS), 'i': sum(sh[i] for i in IDOSOS)})
        if not sec:
            log(el, 'sem seções casadas'); continue
        # base e quintos por escopo (SC ou cidade)
        por = collections.defaultdict(list)
        for s in sec:
            por[s['esc']].append(s)
        base = {}
        for esc, ss in por.items():
            tv = sum(s['val'] for s in ss)
            base[esc] = [round(sum(s['sh'][i] * s['val'] for s in ss) / tv, 4) for i in range(7)]
            for chave_q, campo in (('qj', 'j'), ('qi', 'i')):
                for s, g in zip(ss, quintos([(s[campo], s['val']) for s in ss])):
                    s[chave_q] = g
        valq = collections.defaultdict(lambda: {'qj': [0] * 5, 'qi': [0] * 5})
        for s in sec:
            for k in ('qj', 'qi'):
                valq[s['esc']][k][s[k]] += s['val']
        acc = collections.defaultdict(lambda: {'t': 0, 'm': [0.0] * 7, 'qj': [0] * 5, 'qi': [0] * 5, 'esc': None})
        for s in sec:
            for k, q in s['vs'].items():
                a = acc[k]
                a['t'] += q
                a['esc'] = s['esc']
                for i in range(7):
                    a['m'][i] += s['sh'][i] * q
                a['qj'][s['qj']] += q
                a['qi'][s['qi']] += q
        cand = {}
        for k, a in acc.items():
            if a['t'] < 30:
                continue
            vq = valq[a['esc']]
            cand[str(k)] = {'m': [round(x / a['t'], 4) for x in a['m']], 't': a['t'],
                            'qj': [round(100 * a['qj'][q] / vq['qj'][q], 3) if vq['qj'][q] else 0 for q in range(5)],
                            'qi': [round(100 * a['qi'][q] / vq['qi'][q], 3) if vq['qi'][q] else 0 for q in range(5)]}
        gravar(chave, f'idade-{ano}-{el}', {'ano': ano, 'el': el, 'faixas': FAIXAS, 'b': base, 'c': cand, 'secoes': len(sec)})
        log(f'{ano} {el}: seções casadas {casadas}/{total} ({100 * casadas / max(total, 1):.1f}%) · candidatos {len(cand)}')
    # conferência: eleitores do perfil × aptos do TSE
    cp = os.path.join(D, 'comparecimento.json')
    if os.path.exists(cp):
        aptos = sum(v[0] for v in json.load(open(cp)).get('t1', {}).values())
        n = sum(sum(v) for v in P.values())
        log(f'{ano}: eleitores no perfil {n:,} · aptos (1º turno) {aptos:,} · diferença {100 * (n - aptos) / max(aptos, 1):+.2f}%')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--ano', type=int, nargs='+', required=True)
    ap.add_argument('--secoes', action='store_true', help='só o arquivo com a idade do eleitorado de cada seção')
    a = ap.parse_args()
    k = obter_chave()
    for ano in a.ano:
        gerar(ano, k, a.secoes)
