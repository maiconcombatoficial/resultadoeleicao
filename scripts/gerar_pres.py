"""Apuração de Presidente pelos boletins de urna de TODO o Brasil e do exterior (ZZ).

Uso: python3 scripts/gerar_pres.py --turno 2 [--pleito 3221] [--ufs ac,sc,zz] [--max-min 100]

Para cada UF (27 + ZZ), lê a lista de seções do pleito, baixa o boletim (BU) de cada seção que o TSE já
recebeu, decodifica só o cargo de Presidente e guarda por seção num estado em .cache (incremental: as
execuções seguintes só buscam as seções que ainda faltam). Grava public/dados2026/pres<turno>.json com os
totais por UF, por município (no exterior, por cidade) e, no exterior, seção a seção. Os votos por seção do
Brasil inteiro não vão para o site (seriam centenas de MB): só os agregados.
"""
import argparse, concurrent.futures as cf, datetime, json, os, sys, time
from comum import CACHE, PUBLICO, TSE, baixar, baixar_json, ler_bu_bytes
from baixar_boletins import escolher_pleito

UFS = 'ac al am ap ba ce df es go ma mg ms mt pa pb pe pi pr rj rn ro rr rs sc se sp to zz'.split()


def buscar_bu(base, uf, m, z, s, pleito):
    aux = baixar_json(f'{base}/dados/{uf}/{m}/{z}/{s}/p{pleito:06d}-{uf}-m{m}-z{z}-s{s}-aux.json')
    if not aux:
        return None
    for h in aux.get('hashes', []):
        if h.get('st') not in ('Totalizado', 'Recebido'):
            continue
        for arq in h['arq']:
            if arq['tp'] == 'bu':
                return baixar(f"{base}/dados/{uf}/{m}/{z}/{s}/{h['hash']}/{arq['nm']}")
    return None


def resumo_bu(dados, turno, cargo_key):
    o = ler_bu_bytes(dados, turno)
    arr = o['votos'].get(cargo_key)
    if arr is None:
        return None
    v = {}
    br = nu = 0
    for i in range(0, len(arr), 2):
        nr, q = arr[i], arr[i + 1]
        if nr == 95:
            br += q
        elif nr in (96, 97):
            nu += q
        else:
            v[str(nr)] = v.get(str(nr), 0) + q
    return {'a': o['aptos'], 'c': o['comp'], 'b': br, 'n': nu, 'v': v}


def vazio():
    return {'s': [0, 0], 'a': 0, 'c': 0, 'b': 0, 'n': 0, 'v': {}}


def somar(dst, a, c, b, n, v):
    dst['a'] += a
    dst['c'] += c
    dst['b'] += b
    dst['n'] += n
    for k, q in v.items():
        dst['v'][k] = dst['v'].get(k, 0) + q


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--turno', type=int, default=2)
    ap.add_argument('--pleito', type=int)
    ap.add_argument('--ufs', default=','.join(UFS))
    ap.add_argument('--ciclo', default='ele2026')
    ap.add_argument('--workers', type=int, default=96, help='conexões simultâneas (o gargalo é a rede)')
    ap.add_argument('--max-min', type=float, default=110, help='para de buscar depois desse tempo (a próxima execução continua)')
    ap.add_argument('--saida', default=os.path.join(PUBLICO, 'dados2026'))
    a = ap.parse_args()
    pleito = a.pleito or escolher_pleito(a.turno, a.ciclo)
    if not pleito:
        print('pleito ainda não publicado')
        return
    base = f'{TSE}/{a.ciclo}/arquivo-urna/{pleito}'
    cargo_key = f't{a.turno}-c1'
    os.makedirs(CACHE, exist_ok=True)
    arq_estado = os.path.join(CACHE, f'pres-t{a.turno}-p{pleito}.json')
    estado = json.load(open(arq_estado)) if os.path.exists(arq_estado) else {}
    inicio = time.time()
    estrutura = {}  # uf -> {cd do município: (nome, [(zona, seção)])}
    for uf in [u for u in a.ufs.split(',') if u]:
        cs = baixar_json(f'{base}/config/{uf}/{uf}-p{pleito:06d}-cs.json')
        if not cs:
            print(uf, 'lista de seções ainda não publicada')
            continue
        estrutura[uf] = {m['cd']: (m.get('nm') or m['cd'], [(z['cd'], s['ns']) for z in m['zon'] for s in z['sec']]) for ab in cs['abr'] for m in ab['mu']}
    pend = [(uf, m, z, s) for uf, ms in estrutura.items() for m, (_, secs) in ms.items() for z, s in secs if f'{m}-{z}-{s}' not in estado.setdefault(uf, {})]
    total = sum(len(secs) for ms in estrutura.values() for _, secs in ms.values())
    print(f'{total} seções nas listas, {total - len(pend)} já no estado, {len(pend)} a buscar', flush=True)

    def salvar():
        json.dump(estado, open(arq_estado + '.tmp', 'w'), separators=(',', ':'))
        os.replace(arq_estado + '.tmp', arq_estado)

    # a decodificação do boletim (ASN.1) usa CPU: fica em processos à parte; as threads só esperam a rede
    procs = cf.ProcessPoolExecutor(max_workers=max(1, os.cpu_count() or 2))

    def um(t):
        uf, m, z, s = t
        if time.time() - inicio > a.max_min * 60:
            return t, 'tempo', None
        bu = buscar_bu(base, uf, m, z, s, pleito)
        if not bu:
            return t, 'sem', None
        try:
            return t, 'ok', procs.submit(resumo_bu, bu, a.turno, cargo_key).result()
        except Exception as e:  # boletim ilegível: tenta de novo na próxima
            print('erro BU', t, e, file=sys.stderr)
            return t, 'erro', None

    cont = {}
    ult = time.time()
    with cf.ThreadPoolExecutor(a.workers) as ex:
        for i, (t, st, r) in enumerate(ex.map(um, pend)):
            cont[st] = cont.get(st, 0) + 1
            if r:
                uf, m, z, s = t
                estado[uf][f'{m}-{z}-{s}'] = [r['a'], r['c'], r['b'], r['n'], r['v']]
            if time.time() - ult > 120:
                ult = time.time()
                print(i, len(pend), cont, flush=True)
                salvar()
    procs.shutdown()
    salvar()
    print('buscas', cont, flush=True)

    # agregados: Brasil (todas as UFs, inclusive o exterior), UF, município e, no exterior, seção a seção
    out = {'turno': a.turno, 'pleito': pleito, 'atualizado': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
           'br': vazio(), 'uf': {}, 'mun': {}, 'exterior': {'mun': {}, 'sec': []}}
    for uf, ms in estrutura.items():
        U = vazio()
        M = {}
        for m, (nome, secs) in ms.items():
            X = vazio()
            for z, s in secs:
                X['s'][0] += 1
                r = estado[uf].get(f'{m}-{z}-{s}')
                if not r:
                    continue
                X['s'][1] += 1
                somar(X, r[0], r[1], r[2], r[3], r[4])
                if uf == 'zz':
                    out['exterior']['sec'].append([m, int(z), int(s), r[0], r[1], r[2], r[3], r[4]])
            U['s'][0] += X['s'][0]
            U['s'][1] += X['s'][1]
            somar(U, X['a'], X['c'], X['b'], X['n'], X['v'])
            if X['s'][1]:
                M[m] = {'nome': nome, **X}
        out['uf'][uf] = U
        if uf == 'zz':
            out['exterior']['mun'] = M
        else:
            out['mun'][uf] = M
        out['br']['s'][0] += U['s'][0]
        out['br']['s'][1] += U['s'][1]
        somar(out['br'], U['a'], U['c'], U['b'], U['n'], U['v'])
    os.makedirs(a.saida, exist_ok=True)
    dest = os.path.join(a.saida, f'pres{a.turno}.json')
    # sem boletim novo desde a última vez: não regrava (o workflow não faz commit nem publica o site à toa)
    if os.path.exists(dest):
        try:
            antigo = json.load(open(dest, encoding='utf-8'))
            if {k: v for k, v in antigo.items() if k != 'atualizado'} == {k: v for k, v in out.items() if k != 'atualizado'}:
                print('nada novo desde', antigo.get('atualizado'))
                return
        except Exception:
            pass
    json.dump(out, open(dest, 'w', encoding='utf-8'), separators=(',', ':'), ensure_ascii=False)
    print(f'{dest}: {os.path.getsize(dest) / 1e6:.2f} MB · {out["br"]["s"][1]} de {out["br"]["s"][0]} seções')


if __name__ == '__main__':
    main()
