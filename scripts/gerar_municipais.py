"""Resultado das eleições municipais de SC por cidade (prefeito e câmara) e perfil dos candidatos.

Uso: python3 scripts/gerar_municipais.py --ano 2024      (2012, 2016, 2020 ou 2024)

Lê dados<ano>/resumo.json, mun-*.json, secoes/*.json e comparecimento.json (gerados por gerar_ano.py e
gerar_comparecimento.py), o resumo da eleição municipal anterior (ano − 4) e, do TSE (dados abertos),
consulta_cand_<ano> e bem_candidato_<ano>. Grava:
  dados<ano>/municipal.json  por município: comparecimento, prefeito eleito e adversários, câmara (vagas,
                             eleitos, suplentes, quociente eleitoral), prefeito da eleição anterior
  dados<ano>/perfil.json     por candidato (SQ): idade, gênero, cor/raça, escolaridade, ocupação,
                             estado civil, bens declarados, candidato à reeleição
"""
import argparse, collections, csv, io, json, os, sys, unicodedata, zipfile
from comum import CACHE, CDN, RAIZ, baixar

ap = argparse.ArgumentParser()
ap.add_argument('--ano', type=int, required=True)
a = ap.parse_args()
ANO, UF = a.ano, 'SC'
DIR = os.path.join(RAIZ, f'dados{ANO}')
log = lambda *x: print(*x, file=sys.stderr, flush=True)
csv.field_size_limit(1 << 24)
chave = lambda s: ' '.join(unicodedata.normalize('NFD', s or '').encode('ascii', 'ignore').decode().upper().split())
num = lambda s: float((s or '0').replace(',', '.')) if (s or '').replace(',', '').replace('.', '').lstrip('-').isdigit() else 0.0


def ler(caminho):
    return json.load(open(os.path.join(DIR, caminho)))


def zip_tse(pasta, nome):
    p = os.path.join(CACHE, 'tse', nome + '.zip')
    if not os.path.exists(p):
        os.makedirs(os.path.dirname(p), exist_ok=True)
        log('baixando', nome)
        open(p, 'wb').write(baixar(f'{CDN}/{pasta}/{nome}.zip', timeout=1800))
    return zipfile.ZipFile(p)


def linhas(z):
    nomes = [n for n in z.namelist() if n.endswith(f'_{UF}.csv')] or [n for n in z.namelist() if n.endswith('.csv')]
    with z.open(nomes[0]) as f:
        for r in csv.DictReader(io.TextIOWrapper(f, encoding='latin1', newline=''), delimiter=';'):
            if r.get('SG_UF') == UF:
                yield r


R = ler('resumo.json')
els = {(e['turno'], e['cargo']): e for e in R['eleicoes']}
pref1, pref2, ver = els.get((1, 11)), els.get((2, 11)), els.get((1, 13))
M11 = ler('mun-t1-c11.json')['validos']
M11b = ler('mun-t2-c11.json')['validos'] if pref2 else {}
M13 = ler('mun-t1-c13.json')['validos']
C = ler('comparecimento.json') if os.path.exists(os.path.join(DIR, 'comparecimento.json')) else {}

# legenda de vereador por cidade (números de 2 dígitos nas seções)
legenda = collections.Counter()
for f in os.listdir(os.path.join(DIR, 'secoes')):
    j = json.load(open(os.path.join(DIR, 'secoes', f)))
    for arr in j['votos'].get('t1-c13', {}).values():
        for i in range(0, len(arr), 2):
            if arr[i] < 95:
                legenda[f[:5]] += arr[i + 1]

# candidatos (lista do resumo: [sq, nº, urna, nome, partido, federação, votos, situação, município])
porcd = lambda e: collections.defaultdict(list, {}) if not e else None
def agrupar(e):
    g = collections.defaultdict(list)
    for c in (e['candidatos'] if e else []):
        g[c[8]].append(c)
    return g
P1, P2, V = agrupar(pref1), agrupar(pref2), agrupar(ver)

# perfil e coligação (consulta_cand) e bens (bem_candidato)
info, colig = {}, {}
dic = {k: [] for k in 'grieo'}
idx = lambda k, v: dic[k].index(v) if v in dic[k] else (dic[k].append(v) or len(dic[k]) - 1)
limpo = lambda s: '' if (s or '').startswith('#N') else (s or '').strip()
for r in linhas(zip_tse('consulta_cand', f'consulta_cand_{ANO}')):
    if r.get('CD_TIPO_ELEICAO', '2') != '2' or r.get('CD_CARGO') not in ('11', '13'):
        continue
    sq = r['SQ_CANDIDATO']
    idade = r.get('NR_IDADE_DATA_POSSE', '')
    idade = int(idade) if idade.isdigit() and int(idade) < 120 else None
    if idade is None:  # arquivos recentes só trazem a data de nascimento: idade no dia da eleição
        try:
            dn, de = [list(map(int, x.split('/'))) for x in (r['DT_NASCIMENTO'], r['DT_ELEICAO'])]
            idade = de[2] - dn[2] - ((de[1], de[0]) < (dn[1], dn[0]))
            idade = idade if 16 <= idade < 120 else None
        except (KeyError, ValueError):
            idade = None
    info[sq] = [idade,
                idx('g', limpo(r.get('DS_GENERO'))), idx('r', limpo(r.get('DS_COR_RACA'))),
                idx('i', limpo(r.get('DS_GRAU_INSTRUCAO'))), idx('o', limpo(r.get('DS_OCUPACAO'))),
                idx('e', limpo(r.get('DS_ESTADO_CIVIL'))), 0, 1 if r.get('ST_REELEICAO') == 'S' else 0]
    if r['CD_CARGO'] == '11':
        colig[sq] = limpo(r.get('DS_COMPOSICAO_COLIGACAO') or r.get('DS_COMPOSICAO_FEDERACAO') or '')
bens = collections.Counter()
for r in linhas(zip_tse('bem_candidato', f'bem_candidato_{ANO}')):
    if r.get('CD_TIPO_ELEICAO', '2') == '2':
        bens[r['SQ_CANDIDATO']] += num(r.get('VR_BEM_CANDIDATO'))
for sq, v in bens.items():
    if sq in info:
        info[sq][6] = round(v)
log('perfis', len(info), 'com bens', sum(1 for x in info.values() if x[6]))

# eleição municipal anterior: prefeito eleito em cada cidade
ant = {}
pa = os.path.join(RAIZ, f'dados{ANO - 4}', 'resumo.json')
if os.path.exists(pa):
    Ra = json.load(open(pa))
    for e in Ra['eleicoes']:
        if e['cargo'] != 11:
            continue
        for c in e['candidatos']:
            if c[7] == 'ELEITO':
                ant[c[8]] = {'n': c[2], 'nc': c[3], 'p': c[4]}

pct = lambda v, t: round(100 * v / t, 2) if t else 0
saida = {}
for cd in sorted(set(P1) | set(V)):
    o = {}
    if cd in C.get('t1', {}):
        o['ap'] = C['t1'][cd]
    # prefeito: 2º turno, quando houver, decide
    cands = sorted(P1.get(cd, []), key=lambda c: -c[6])
    fim = sorted(P2.get(cd, []), key=lambda c: -c[6]) if cd in P2 else None
    eleito = next((c for c in (fim or cands) if c[7] == 'ELEITO'), None)
    val = M11.get(cd, 0)
    if eleito:
        v = eleito[6] if not fim else next(c[6] for c in fim if c[0] == eleito[0])
        tv = M11b.get(cd, 0) if fim else val
        a_ = ant.get(cd)
        o['pf'] = {'sq': eleito[0], 'n': eleito[2], 'nc': eleito[3], 'p': eleito[4], 'v': v, 'pct': pct(v, tv), 't2': bool(fim),
                   'ree': bool(a_ and chave(a_['nc']) == chave(eleito[3])) or bool(info.get(eleito[0], [0] * 8)[7]),
                   'col': colig.get(eleito[0], '')}
    o['adv'] = [[c[0], c[2], c[4], c[6], pct(c[6], val)] for c in cands if not eleito or c[0] != eleito[0]]
    if fim:
        o['t2'] = [[c[0], c[2], c[4], c[6], pct(c[6], M11b.get(cd, 0))] for c in fim]
    o['vp'] = val
    # câmara
    vs = sorted(V.get(cd, []), key=lambda c: -c[6])
    el = [[c[0], c[2], c[4], c[6], 'QP' if 'QP' in c[7] else 'média' if 'DIA' in c[7] else ''] for c in vs if c[7].startswith('ELEITO')]
    sup = collections.defaultdict(list)
    for c in vs:
        if c[7] == 'SUPLENTE' and len(sup[c[4]]) < 2:
            sup[c[4]].append([c[0], c[2], c[4], c[6]])
    vagas = len(el)
    vt = M13.get(cd, 0) + legenda[cd]
    o['cam'] = {'vagas': vagas, 'val': vt, 'leg': legenda[cd], 'qe': round(vt / vagas) if vagas else 0, 'el': el, 'sup': [x for l in sup.values() for x in l]}
    if cd in ant:
        o['ant'] = {'n': ant[cd]['n'], 'p': ant[cd]['p']}
    saida[cd] = o

json.dump(saida, open(os.path.join(DIR, 'municipal.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
# perfil só de quem está no resumo (candidatos que tiveram registro e votação)
sqs = {c[0] for e in (pref1, pref2, ver) if e for c in e['candidatos']}
json.dump({'dic': dic, 'c': {sq: v for sq, v in info.items() if sq in sqs}}, open(os.path.join(DIR, 'perfil.json'), 'w'), ensure_ascii=False, separators=(',', ':'))

# conferência
prefs = [o['pf'] for o in saida.values() if 'pf' in o]
log(f'{ANO}: municípios {len(saida)} · prefeitos eleitos {len(prefs)} · reeleitos {sum(p["ree"] for p in prefs)} · 2º turno {sum(p["t2"] for p in prefs)}')
log('prefeituras por partido', collections.Counter(p['p'] for p in prefs).most_common(8))
log('vereadores eleitos', sum(o['cam']['vagas'] for o in saida.values()), '· perfis', len(sqs & set(info)), 'de', len(sqs))
for cd in ('81051', '81795', '80047'):
    if cd in saida:
        o = saida[cd]
        log(cd, o.get('pf', {}).get('n'), o.get('pf', {}).get('p'), o.get('pf', {}).get('pct'), '% · câmara', o['cam']['vagas'], 'QE', o['cam']['qe'])
