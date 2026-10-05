"""Baixa os boletins de urna (BU) de todas as seções de uma UF, de um pleito do TSE, para .cache/bu/<pleito>/.

Uso: python3 scripts/baixar_boletins.py --turno 2 [--uf sc] [--pleito 3220]
"""
import argparse, concurrent.futures as cf, json, os, sys
from comum import CACHE, TSE, baixar, baixar_json, pleitos


def escolher_pleito(turno, ciclo='ele2026'):
    ps = [p for p in pleitos(ciclo) if p['turno'] == turno and any(e in (6257, 6258, 6259, 6260) for e in p['eleicoes'])]
    if not ps:
        ps = [p for p in pleitos(ciclo) if p['turno'] == turno]
    return ps[0]['cd'] if ps else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--turno', type=int, default=1)
    ap.add_argument('--uf', default='sc')
    ap.add_argument('--pleito', type=int)
    ap.add_argument('--ciclo', default='ele2026')
    a = ap.parse_args()
    pleito = a.pleito or escolher_pleito(a.turno, a.ciclo)
    if not pleito:
        sys.exit(f'pleito do {a.turno}º turno ainda não publicado')
    base = f'{TSE}/{a.ciclo}/arquivo-urna/{pleito}'
    cs = baixar_json(f'{base}/config/{a.uf}/{a.uf}-p{pleito:06d}-cs.json')
    if not cs:
        print('lista de seções ainda não publicada'); sys.exit(0)
    pasta = os.path.join(CACHE, 'bu', str(pleito))
    os.makedirs(pasta, exist_ok=True)
    tarefas = [(m['cd'], z['cd'], s['ns']) for ab in cs['abr'] for m in ab['mu'] for z in m['zon'] for s in z['sec']]

    def um(t):
        m, z, s = t
        dest = os.path.join(pasta, f'{m}-{z}-{s}.bu')
        if os.path.exists(dest):
            return 'cache'
        aux = baixar_json(f'{base}/dados/{a.uf}/{m}/{z}/{s}/p{pleito:06d}-{a.uf}-m{m}-z{z}-s{s}-aux.json')
        if not aux:
            return 'sem-aux'  # seção agregada a outra, ou ainda não recebida
        for h in aux.get('hashes', []):
            if h.get('st') not in ('Totalizado', 'Recebido'):
                continue
            for arq in h['arq']:
                if arq['tp'] == 'bu':
                    d = baixar(f"{base}/dados/{a.uf}/{m}/{z}/{s}/{h['hash']}/{arq['nm']}")
                    if d:
                        open(dest + '.tmp', 'wb').write(d)
                        os.replace(dest + '.tmp', dest)
                        return 'ok'
        return 'sem-bu'

    cont = {}
    with cf.ThreadPoolExecutor(32) as ex:
        for i, r in enumerate(ex.map(um, tarefas)):
            cont[r] = cont.get(r, 0) + 1
            if i % 2000 == 0:
                print(i, len(tarefas), cont, flush=True)
    print('pleito', pleito, 'seções', len(tarefas), cont, flush=True)
    json.dump({'pleito': pleito, 'turno': a.turno, 'uf': a.uf, 'secoes': len(tarefas), 'resultado': cont}, open(os.path.join(pasta, 'resumo.json'), 'w'))


if __name__ == '__main__':
    main()
