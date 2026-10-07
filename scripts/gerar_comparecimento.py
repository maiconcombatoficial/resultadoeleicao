"""Acrescenta aptos e comparecimento de cada seção aos arquivos dados<ano>/secoes/<cd>.json (campo "ap") e grava
dados<ano>/comparecimento.json (totais por município), para o app mostrar abstenção, brancos e nulos por
zona, bairro, local, seção e município.

Uso: python3 scripts/gerar_comparecimento.py --ano 2024      (2012 a 2026)

Fonte: TSE, dados abertos, detalhe_votacao_secao_<ano> (aptos, comparecimento, abstenções, brancos e nulos
por seção e cargo). Os votos já gravados nos arquivos de seções não mudam.
  secoes/<cd>.json  → "ap": {"t1": {"<zona>-<seção>": [aptos, comparecimento]}, "t2": {...}}
  comparecimento.json → {"t1": {"<cd>": [aptos, comparecimento]}, "brnu": {"t1-c7": {"<cd>": [brancos, nulos]}}}
Aptos e comparecimento da seção: os do cargo com mais eleitores (são os mesmos em todos os cargos, salvo
seções com eleitores em trânsito).
"""
import argparse, collections, csv, io, json, os, sys, zipfile
from comum import CACHE, CDN, RAIZ, baixar

ap = argparse.ArgumentParser()
ap.add_argument('--ano', type=int, required=True)
a = ap.parse_args()
ANO, UF = a.ano, 'SC'
DIR = os.path.join(RAIZ, f'dados{ANO}')
log = lambda *x: print(*x, file=sys.stderr, flush=True)
csv.field_size_limit(1 << 24)
inteiro = lambda s: int(s) if (s or '').lstrip('-').isdigit() else 0

nome = f'detalhe_votacao_secao_{ANO}'
p = os.path.join(CACHE, 'tse', nome + '.zip')
if not os.path.exists(p):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    log('baixando', nome)
    open(p, 'wb').write(baixar(f'{CDN}/detalhe_votacao_secao/{nome}.zip', timeout=1800))
z = zipfile.ZipFile(p)
arqs = [n for n in z.namelist() if n.endswith(f'_{UF}.csv')] or [n for n in z.namelist() if n.endswith('.csv')]

secao = collections.defaultdict(dict)  # (turno, cd) -> zs -> [aptos, comp]
brnu = collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0]))  # el -> cd -> [br, nu]
n = 0
with z.open(arqs[0]) as f:
    for r in csv.DictReader(io.TextIOWrapper(f, encoding='latin1', newline=''), delimiter=';'):
        if r.get('SG_UF') != UF or r.get('CD_TIPO_ELEICAO', '2') != '2':
            continue
        t, cd, cargo = int(r['NR_TURNO']), r['CD_MUNICIPIO'].zfill(5), int(r['CD_CARGO'])
        zs = f"{int(r['NR_ZONA'])}-{int(r['NR_SECAO'])}"
        aptos, comp = inteiro(r['QT_APTOS']), inteiro(r['QT_COMPARECIMENTO'])
        atual = secao[(t, cd)].get(zs)
        if not atual or aptos > atual[0]:
            secao[(t, cd)][zs] = [aptos, comp]
        b = brnu[f't{t}-c{cargo}'][cd]
        b[0] += inteiro(r['QT_VOTOS_BRANCOS'])
        b[1] += inteiro(r['QT_VOTOS_NULOS']) + inteiro(r.get('QT_VOTOS_ANULADOS_APU_SEP'))
        n += 1
log('linhas', n, 'turnos', sorted({t for t, _ in secao}))

# grava "ap" nos arquivos de seções que existem (os votos não mudam)
porcd = collections.defaultdict(dict)
for (t, cd), d in secao.items():
    porcd[cd][f't{t}'] = d
pasta = os.path.join(DIR, 'secoes')
feitos = sem = 0
for f in sorted(os.listdir(pasta)):
    cd = f[:5]
    if cd not in porcd:
        sem += 1
        continue
    caminho = os.path.join(pasta, f)
    j = json.load(open(caminho))
    j['ap'] = {**j.get('ap', {}), **porcd[cd]}
    json.dump(j, open(caminho, 'w'), ensure_ascii=False, separators=(',', ':'))
    feitos += 1
log('arquivos de seções', feitos, 'sem dados do TSE', sem)

tot = {f't{t}': {} for t, _ in secao}
for (t, cd), d in secao.items():
    tot[f't{t}'][cd] = [sum(v[0] for v in d.values()), sum(v[1] for v in d.values())]
tot['brnu'] = {el: dict(m) for el, m in brnu.items()}
json.dump(tot, open(os.path.join(DIR, 'comparecimento.json'), 'w'), separators=(',', ':'))
for t in sorted(k for k in tot if k != 'brnu'):
    ap_, cp = sum(v[0] for v in tot[t].values()), sum(v[1] for v in tot[t].values())
    log(f'{ANO} {t}: aptos {ap_:,} comparecimento {cp:,} abstenção {100 * (ap_ - cp) / max(ap_, 1):.2f}%')
