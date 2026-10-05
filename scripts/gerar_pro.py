"""Gera os dados da área protegida (🔒 Análises) e os criptografa em pro/*.bin.

A chave dos dados vem de PRO_CHAVE (base64) ou é aberta com PRO_SENHA a partir de pro/usuarios.json.
Novo usuário:  PRO_SENHA=<senha atual> python3 scripts/gerar_pro.py --usuario NOME --senha-nova SENHA
Gerar dados:   PRO_SENHA=<senha> python3 scripts/gerar_pro.py   (depois de gerar_bairros.py)
Nenhuma senha é gravada: usuarios.json guarda só a chave dos dados embrulhada por PBKDF2-SHA256 + AES-GCM.
"""
import argparse, base64, collections, csv, gzip, hashlib, io, json, os, sys, zipfile
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from comum import CACHE, CDN, RAIZ, TSE, baixar, baixar_json, chave_nome, ler_locais
from transferencia import de_arquivos

OUT = os.path.join(RAIZ, 'pro')
ITER = 310000
os.makedirs(OUT, exist_ok=True)
log = lambda *x: print(*x, file=sys.stderr, flush=True)
b64 = lambda b: base64.b64encode(b).decode()
kek = lambda senha, sal: hashlib.pbkdf2_hmac('sha256', senha.encode(), sal, ITER, 32)
id_usuario = lambda u: hashlib.sha256(('usuario:' + u.strip().lower()).encode()).hexdigest()
USU = os.path.join(OUT, 'usuarios.json')
usuarios = json.load(open(USU)) if os.path.exists(USU) else {'v': 1, 'iter': ITER, 'u': {}}


def obter_chave():
    if os.environ.get('PRO_CHAVE'):
        return base64.b64decode(os.environ['PRO_CHAVE'])
    if usuarios['u'] and os.environ.get('PRO_SENHA'):
        for u in usuarios['u'].values():
            try:
                w = base64.b64decode(u['w'])
                return AESGCM(kek(os.environ['PRO_SENHA'], base64.b64decode(u['s']))).decrypt(w[:12], w[12:], None)
            except Exception:
                pass
        sys.exit('senha não confere com nenhum usuário')
    if usuarios['u']:
        sys.exit('defina PRO_CHAVE ou PRO_SENHA')
    return AESGCM.generate_key(256)  # primeira vez


def add_usuario(chave, nome, senha):
    sal, iv = os.urandom(16), os.urandom(12)
    usuarios['u'][id_usuario(nome)] = {'s': b64(sal), 'w': b64(iv + AESGCM(kek(senha, sal)).encrypt(iv, chave, None))}
    json.dump(usuarios, open(USU, 'w'), indent=1)


def gravar(chave, nome, obj):
    dados = gzip.compress(json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode(), 9, mtime=0)
    iv = os.urandom(12)
    open(os.path.join(OUT, f'{nome}.bin'), 'wb').write(iv + AESGCM(chave).encrypt(iv, dados, None))
    log(nome, len(dados), 'bytes')


def perfil_por_secao():
    """Perfil do eleitorado por seção (TSE): [total, mulheres, 16-24, 25-34, 35-44, 45-59, 60+, até fund. incompleto, médio compl./sup. incompl., superior]."""
    cache = os.path.join(CACHE, 'perfil_secao_2026_SC.json')
    if os.path.exists(cache):
        return {tuple(k.split('|')): v for k, v in json.load(open(cache)).items()}
    z = zipfile.ZipFile(io.BytesIO(baixar(f'{CDN}/perfil_eleitor_secao/perfil_eleitor_secao_2026_SC.zip', timeout=900)))
    nome = [n for n in z.namelist() if n.endswith('.csv')][0]
    P = collections.defaultdict(lambda: [0] * 10)
    with z.open(nome) as f:
        for r in csv.DictReader(io.TextIOWrapper(f, encoding='latin1', newline=''), delimiter=';'):
            q = int(r['QT_ELEITORES']); p = P[(r['CD_MUNICIPIO'].zfill(5), f"{int(r['NR_ZONA'])}-{int(r['NR_SECAO'])}")]
            p[0] += q
            if r['CD_GENERO'] == '4':
                p[1] += q
            fx = r['CD_FAIXA_ETARIA']
            idade = int(fx[:2]) if len(fx) >= 4 else 0
            p[2 if idade < 25 else 3 if idade < 35 else 4 if idade < 45 else 5 if idade < 60 else 6] += q
            e = int(r['CD_GRAU_ESCOLARIDADE'])
            if e in (1, 2, 3): p[7] += q
            elif e in (6, 7): p[8] += q
            elif e == 8: p[9] += q
    json.dump({f'{k[0]}|{k[1]}': v for k, v in P.items()}, open(cache, 'w'))
    return P


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--usuario'); ap.add_argument('--senha-nova')
    a = ap.parse_args()
    chave = obter_chave()
    if a.usuario:
        add_usuario(chave, a.usuario, a.senha_nova); log('usuário gravado'); return
    if not usuarios['u']:
        add_usuario(chave, os.environ['PRO_USUARIO'], os.environ['PRO_SENHA'])

    D26 = os.path.join(RAIZ, 'dados2026')
    ELS = json.load(open(os.path.join(D26, 'indice.json')))['eleicoes']
    secoes = {f[:5]: json.load(open(os.path.join(D26, 'secoes', f))) for f in os.listdir(os.path.join(D26, 'secoes'))}
    L, S, PRINC = ler_locais(2026, 1)
    num = lambda s: round(float(s.replace(',', '.')), 5) if s and s not in ('-1', '#NULO#') else None

    # locais: coordenadas, bairro, aptos, comparecimento, brancos/nulos por cargo — um arquivo por turno
    for turno in sorted({int(el[1]) for el in ELS}):
        arq_comp = os.path.join(CACHE, f'comparecimento-t{turno}.json')
        if not os.path.exists(arq_comp):
            log('sem comparecimento do turno', turno, '(rode gerar_bairros.py antes)'); continue
        comp = json.load(open(arq_comp))
        cargos = [el for el in ELS if el.startswith(f't{turno}-')]
        locais = collections.defaultdict(dict)
        for cd, arq in secoes.items():
            for zs, k in arq['secoes'].items():
                if not any(zs in arq['votos'].get(el, {}) for el in cargos):
                    continue
                nome, _, _, lat, lon = L.get((cd, k)) or ['', '', '', None, None]
                l = locais[cd].setdefault(k, [num(lat) if lat else None, num(lon) if lon else None, nome, arq['locais'][k][2], 0, 0] + [0] * (2 * len(cargos)))
                ap_, cp = comp.get(f'{cd}|{zs}', [0, 0]); l[4] += ap_; l[5] += cp
                for i, el in enumerate(cargos):
                    v = arq['votos'].get(el, {}).get(zs, [])
                    for j in range(0, len(v), 2):
                        if v[j] == 95: l[6 + 2 * i] += v[j + 1]
                        elif v[j] in (96, 97): l[7 + 2 * i] += v[j + 1]
        log('turno', turno, 'aptos', sum(l[4] for m in locais.values() for l in m.values()), 'comparecimento', sum(l[5] for m in locais.values() for l in m.values()))
        gravar(chave, 'locais' if turno == 1 else f'locais-t{turno}', {'cargos': cargos, 'turno': turno, 'l': locais})

    # votos por município (mapa de SC), com 2022 ligado pelo nome completo
    r22 = json.load(open(os.path.join(RAIZ, 'dados2022', 'resumo.json')))
    idx22 = collections.defaultdict(list)
    for e in r22['eleicoes']:
        for x in e['candidatos']:
            idx22[chave_nome(x[3])].append((e['turno'], e['cargo'], x[0]))
    mun22 = {f[4:-5]: json.load(open(os.path.join(RAIZ, 'dados2022', f))) for f in os.listdir(os.path.join(RAIZ, 'dados2022')) if f.startswith('mun-')}
    for el in ELS:
        t, c = int(el[1]), int(el.split('-c')[1])
        ele = (6257 if c == 1 else 6259) + (t - 1)
        j = baixar_json(f'{TSE}/ele2026/{ele}/dados/sc/sc-c{c:04d}-e{ele:06d}-u.json') or {'carg': []}
        nomes = {int(x['n']): x['nm'] for cg in j['carg'] for ag in cg['agr'] for p in ag['par'] for x in p['cand']}
        porMun, validos = collections.defaultdict(collections.Counter), collections.Counter()
        for cd, arq in secoes.items():
            for zs, v in arq['votos'].get(el, {}).items():
                for i in range(0, len(v), 2):
                    nr, q = v[i], v[i + 1]
                    if nr in (95, 96, 97): continue
                    validos[cd] += q
                    if c in (6, 7) and nr < 100: continue
                    porMun[nr][cd] += q
        out = {'validos': validos, 'c': {}, 'validos22': {k: m['validos'] for k, m in mun22.items()}}
        for nr, cnt in porMun.items():
            e = {'v': cnt}
            parts = idx22.get(chave_nome(nomes.get(nr)))
            if parts:
                t22, c22, sq = next((p for p in parts if p[0] == t and p[1] == c), None) or next((p for p in parts if p[0] == 1 and p[1] == c), None) or next(p for p in parts if p[0] == 1)
                k22 = f't{t22}-c{c22}'
                if k22 in mun22:
                    e['v22'] = mun22[k22]['cand'].get(sq, {}); e['e22'] = k22
            out['c'][nr] = e
        gravar(chave, f'mun-{el}', out)

    # perfil do eleitor: média ponderada e quintis por atributo
    P = perfil_por_secao()
    perf = collections.defaultdict(lambda: [0] * 10)
    for (cd, zs), v in P.items():
        p = perf[(cd, PRINC.get((cd, zs), zs))]
        for i in range(10): p[i] += v[i]
    ATR = ['Mulheres', '16 a 24 anos', '25 a 34 anos', '35 a 44 anos', '45 a 59 anos', '60 anos ou mais', 'Até fundamental incompleto', 'Médio completo ou superior incompleto', 'Superior completo']
    for el in ELS:
        c = int(el.split('-c')[1])
        sec = []
        for cd, arq in secoes.items():
            for zs, v in arq['votos'].get(el, {}).items():
                p = perf.get((cd, zs))
                if not p or not p[0]: continue
                vs, val = {}, 0
                for i in range(0, len(v), 2):
                    nr, q = v[i], v[i + 1]
                    if nr in (95, 96, 97): continue
                    val += q
                    if c in (6, 7) and nr < 100: continue
                    vs[nr] = q
                if val: sec.append(([p[i] / p[0] for i in range(1, 10)], val, vs))
        tot = sum(s[1] for s in sec)
        base = [sum(s[0][i] * s[1] for s in sec) / tot for i in range(9)]
        grupos = []
        for i in range(9):
            g, acc = [0] * len(sec), 0
            for j in sorted(range(len(sec)), key=lambda j: sec[j][0][i]):
                g[j] = min(4, int(5 * acc / tot)); acc += sec[j][1]
            grupos.append(g)
        valq = [[0] * 5 for _ in range(9)]
        for i in range(9):
            for j, s in enumerate(sec): valq[i][grupos[i][j]] += s[1]
        faixas = [[min(sec[j][0][i] for j in range(len(sec)) if grupos[i][j] == q) for q in range(5)] + [max(s[0][i] for s in sec)] for i in range(9)]
        nrs = {nr for s in sec for nr in s[2]}
        vq = {nr: [[0] * 5 for _ in range(9)] for nr in nrs}; wm = {nr: [0.0] * 9 for nr in nrs}; vt = collections.Counter()
        for j, s in enumerate(sec):
            for nr, q in s[2].items():
                vt[nr] += q
                for i in range(9):
                    wm[nr][i] += s[0][i] * q; vq[nr][i][grupos[i][j]] += q
        cand = {nr: {'m': [round(wm[nr][i] / vt[nr], 4) for i in range(9)], 'q': [[round(100 * vq[nr][i][q] / valq[i][q], 3) for q in range(5)] for i in range(9)], 't': vt[nr]} for nr in nrs if vt[nr] >= 50}
        gravar(chave, f'perfil-{el}', {'atributos': ATR, 'base': [round(x, 4) for x in base], 'faixas': [[round(x, 4) for x in f] for f in faixas], 'c': cand, 'secoes': len(sec)})

    # transferência de votos entre turnos (2026, quando houver 2º turno) e governador de SC em 2022
    for el2 in [el for el in ELS if el.startswith('t2-')]:
        el1 = 't1-' + el2.split('-')[1]
        if el1 in ELS:
            gravar(chave, f'transf-{el2.split("-")[1]}', {'ano': 2026, **de_arquivos(secoes.values(), el1, el2)})
    s22 = [json.load(open(os.path.join(RAIZ, 'dados2022', 'secoes', f))) for f in os.listdir(os.path.join(RAIZ, 'dados2022', 'secoes'))]
    gravar(chave, 'transf22-c3', {'ano': 2022, **de_arquivos(s22, 't1-c3', 't2-c3')})


if __name__ == '__main__':
    main()
