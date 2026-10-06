"""Gera dados<ano>/ de uma eleição anterior em SC, a partir dos dados abertos do TSE.

Uso: python3 scripts/gerar_ano.py --ano 2024      (2012, 2014, 2016, 2018, 2020, 2022, 2024)

Lê votacao_candidato_munzona_<ano> (candidatos, situação, votos por município) e votacao_secao_<ano>_SC
(votos de cada seção) e grava, no mesmo formato de dados2022/:
  resumo.json            eleições, candidatos, partidos e votos anulados
  mun-<eleição>.json     votos de cada candidato por município
  secoes/<cd>.json       votos por seção e local de votação
Depois chama gerar_bairros.py --ano <ano>, que acrescenta o bairro de cada local (cadastro de locais do TSE)
e grava bairros-<eleição>.json, municipios-<eleição>.json e indice.json.
Só entram as eleições ordinárias (suplementares ficam de fora). Eleição = 't<turno>-c<cargo>':
c3 Governador, c5 Senado, c6 Dep. Federal, c7 Dep. Estadual, c11 Prefeito, c13 Vereador.
"""
import argparse, collections, csv, io, json, os, subprocess, sys, zipfile
from comum import CACHE, CDN, RAIZ, baixar

ap = argparse.ArgumentParser()
ap.add_argument('--ano', type=int, required=True)
a = ap.parse_args()
ANO, UF = a.ano, 'SC'
DIR = os.path.join(RAIZ, f'dados{ANO}')
CARGOS = {3: 'Governador', 5: 'Senador', 6: 'Deputado Federal', 7: 'Deputado Estadual', 11: 'Prefeito', 13: 'Vereador'}
VAGAS = {3: 1, 5: 2 if ANO == 2018 else 1, 6: 16, 7: 40, 11: 1, 13: 0}
log = lambda *x: print(*x, file=sys.stderr, flush=True)
csv.field_size_limit(1 << 24)


def zip_tse(nome):
    os.makedirs(os.path.join(CACHE, 'tse'), exist_ok=True)
    p = os.path.join(CACHE, 'tse', nome + '.zip')
    if not os.path.exists(p):
        log('baixando', nome)
        sub = nome.rsplit('_', 2)[0] if nome.endswith('_SC') else nome.rsplit('_', 1)[0]
        open(p, 'wb').write(baixar(f'{CDN}/{sub}/{nome}.zip', timeout=1800))
    return zipfile.ZipFile(p)


def linhas(z, sufixo):
    nomes = [n for n in z.namelist() if n.endswith(sufixo)] or [n for n in z.namelist() if n.endswith('.csv')]
    with z.open(nomes[0]) as f:
        for r in csv.DictReader(io.TextIOWrapper(f, encoding='latin1', newline=''), delimiter=';'):
            if r.get('SG_UF') == UF and r.get('CD_TIPO_ELEICAO', '2') == '2' and int(r['CD_CARGO']) in CARGOS:
                yield r


limpo = lambda s: '' if s in ('#NULO#', '#NULO', '#NE#', '#NE', '-1', '-3') else s.strip()
inteiro = lambda s: int(s or 0) if (s or '0').lstrip('-').isdigit() else 0

# 1) candidatos: totais, situação, partido e votos por município
tot, mun, info = collections.Counter(), collections.defaultdict(collections.Counter), {}
validos, munval = collections.Counter(), collections.defaultdict(collections.Counter)
partidos, anulados = {}, set()
for r in linhas(zip_tse(f'votacao_candidato_munzona_{ANO}'), f'_{UF}.csv'):
    t, c, sq, cd = int(r['NR_TURNO']), int(r['CD_CARGO']), r['SQ_CANDIDATO'], r['CD_MUNICIPIO'].zfill(5)
    el = f't{t}-c{c}'
    v = inteiro(r.get('QT_VOTOS_NOMINAIS_VALIDOS') or r.get('QT_VOTOS_NOMINAIS'))
    dest = r.get('NM_TIPO_DESTINACAO_VOTOS', '')
    nominais = inteiro(r.get('QT_VOTOS_NOMINAIS'))
    # anulado / anulado sub judice: não conta como válido (arquivos antigos não têm a destinação,
    # mas trazem os votos nominais com zero válidos)
    if (dest and not dest.lower().startswith('v')) or (r.get('QT_VOTOS_NOMINAIS_VALIDOS') is not None and v == 0 and nominais > 0):
        anulados.add((el, r['NR_CANDIDATO'] + (f'-{cd}' if c in (11, 13) else '')))
        v = 0
    tot[(el, sq)] += v
    mun[(el, sq)][cd] += v
    validos[el] += v
    munval[el][cd] += v
    partidos[r['NR_PARTIDO']] = r['SG_PARTIDO']
    info[(el, sq)] = [r['NR_CANDIDATO'], limpo(r['NM_URNA_CANDIDATO']), limpo(r['NM_CANDIDATO']), r['SG_PARTIDO'],
                      limpo(r.get('SG_FEDERACAO', '')), limpo(r['DS_SIT_TOT_TURNO']), cd if c in (11, 13) else '']
log('candidatos', len(info), 'eleições', sorted(validos))

os.makedirs(os.path.join(DIR, 'secoes'), exist_ok=True)
resumo = {'ano': ANO, 'municipal': any(k.endswith(('c11', 'c13')) for k in validos),
          'fonte': f'TSE · dados abertos: votacao_candidato_munzona_{ANO} e votacao_secao_{ANO}_SC', 'eleicoes': [],
          'partidos': partidos, 'anulados': sorted(f'{el}-{nr}' for el, nr in anulados)}
for el in sorted(validos, key=lambda e: (int(e[1]), int(e.split('-c')[1]))):
    t, c = int(el[1]), int(el.split('-c')[1])
    ks = sorted((k for k in info if k[0] == el), key=lambda k: -tot[k])
    cands = [[k[1]] + info[k][:5] + [tot[k], info[k][5]] + ([info[k][6]] if info[k][6] else []) for k in ks]
    resumo['eleicoes'].append({'turno': t, 'cargo': c, 'nome': CARGOS[c], 'vagas': VAGAS[c], 'validos': validos[el], 'candidatos': cands})
    m = {k[1]: {cd: v for cd, v in mun[k].items() if v} for k in ks if tot[k] > 0}
    json.dump({'validos': munval[el], 'cand': m}, open(os.path.join(DIR, f'mun-{el}.json'), 'w'), separators=(',', ':'), ensure_ascii=False)

# 2) votos por seção
validos_nr = {(el, str(int(info[(el, sq)][0])) + (f'-{info[(el, sq)][6]}' if info[(el, sq)][6] else '')) for (el, sq) in info if tot[(el, sq)] > 0}
locais = collections.defaultdict(dict)
secloc = collections.defaultdict(dict)
votos = collections.defaultdict(lambda: collections.defaultdict(lambda: collections.defaultdict(list)))
n = 0
for r in linhas(zip_tse(f'votacao_secao_{ANO}_{UF}'), f'_{UF}.csv'):
    cd = r['CD_MUNICIPIO'].zfill(5)
    z, s = str(int(r['NR_ZONA'])), str(int(r['NR_SECAO']))
    loc = f"{z}-{int(r['NR_LOCAL_VOTACAO'])}" if r.get('NR_LOCAL_VOTACAO') else f'{z}-0'
    locais[cd].setdefault(loc, [r.get('NM_LOCAL_VOTACAO', '').strip(), r.get('DS_LOCAL_VOTACAO_ENDERECO', '').strip(), ''])
    secloc[cd][f'{z}-{s}'] = loc
    el, nr = f"t{int(r['NR_TURNO'])}-c{int(r['CD_CARGO'])}", int(r['NR_VOTAVEL'])
    votos[cd][el][f'{z}-{s}'] += [nr, int(r['QT_VOTOS'])]
    # votos de candidato sem votos válidos (inapto, renúncia, cassado…): nos arquivos antigos, o munzona
    # traz zero e a seção traz os votos, que o TSE contou como nulos
    if nr not in (95, 96, 97) and not (int(r['CD_CARGO']) in (6, 7, 13) and nr < 100):
        k = (el, str(nr) + (f'-{cd}' if int(r['CD_CARGO']) in (11, 13) else ''))
        if k not in validos_nr:
            anulados.add(k)
    n += 1
for cd in locais:
    j = {'locais': locais[cd], 'secoes': secloc[cd], 'votos': {e: dict(v) for e, v in votos[cd].items()}}
    json.dump(j, open(os.path.join(DIR, 'secoes', f'{cd}.json'), 'w'), separators=(',', ':'), ensure_ascii=False)
log('linhas por seção', n, 'municípios', len(locais))
resumo['anulados'] = sorted(f'{el}-{nr}' for el, nr in anulados)
log('anulados', len(anulados))
json.dump(resumo, open(os.path.join(DIR, 'resumo.json'), 'w'), separators=(',', ':'), ensure_ascii=False)

# 3) bairros (cadastro de locais), índices por bairro e por município
subprocess.run([sys.executable, os.path.join(RAIZ, 'scripts', 'gerar_bairros.py'), '--ano', str(ANO)], check=True)
