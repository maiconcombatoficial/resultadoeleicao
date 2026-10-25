"""Série da apuração do 2º turno de Presidente (Brasil e SC) para o gráfico de evolução da aba Presidente.

Uso: python3 scripts/serie_2t.py [--intervalo 60] [--publicar 300]

Consulta o resultado do TSE do Brasil e de SC (2 arquivos por rodada, nada além disso: não arrisca bloqueio)
e acrescenta um ponto sempre que o % de seções totalizadas muda. Grava public/dados2026/serie2t.json:
  {"n": [números dos candidatos], "br": [[% apurado, horário (ms), votos do 1º número, votos do 2º]], "sc": [...]}
Com --publicar, faz commit e push do arquivo nesse intervalo (segundos) quando há ponto novo. Para sozinho
quando o TSE marca a totalização final das duas abrangências.
"""
import argparse, json, os, subprocess, sys, time
from comum import PUBLICO, TSE, baixar_json

ELEICAO = '6258'
ABRS = ('br', 'sc')


def ler(abr):
    d = baixar_json(f'{TSE}/ele2026/{ELEICAO}/dados/{abr}/{abr}-c0001-e00{ELEICAO}-u.json')
    if not d:
        return None
    cands = {str(c['n']): int(str(c.get('vap') or 0)) for a in d['carg'][0]['agr'] for p in a['par'] for c in p['cand']}
    pst = float(str(d['s'].get('pst') or '0').replace(',', '.'))
    return pst, cands, d.get('tf') == 's'


def publicar(dest):
    raiz = os.path.dirname(PUBLICO)
    g = lambda *a: subprocess.run(['git', '-C', raiz, *a], capture_output=True, text=True)
    if not g('status', '--porcelain', dest).stdout.strip():
        return
    g('add', dest)
    g('commit', '-m', 'Série da apuração do 2º turno (Presidente, Brasil e SC)\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')
    for i in range(4):
        if g('pull', '--rebase', 'origin', 'main').returncode == 0 and g('push', 'origin', 'HEAD:main').returncode == 0:
            print('publicado', time.strftime('%H:%M'), flush=True)
            return
        time.sleep(10 * (i + 1))
    print('falhou ao publicar', file=sys.stderr, flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--intervalo', type=int, default=60)
    ap.add_argument('--publicar', type=int, default=0)
    a = ap.parse_args()
    dest = os.path.join(PUBLICO, 'dados2026', 'serie2t.json')
    serie = json.load(open(dest)) if os.path.exists(dest) else {'n': [], **{x: [] for x in ABRS}}
    ult_pub = 0
    while True:
        finais = 0
        for abr in ABRS:
            try:
                r = ler(abr)
            except Exception as e:  # TSE fora do ar ou lento: tenta na próxima rodada
                print(abr, 'erro', e, file=sys.stderr, flush=True)
                continue
            if not r:
                continue
            pst, cands, final = r
            finais += final
            if not serie['n']:
                serie['n'] = sorted(cands)
            pts = serie[abr]
            if pst > 0 and (not pts or pst > pts[-1][0]):
                pts.append([pst, int(time.time() * 1000), *[cands.get(n, 0) for n in serie['n']]])
                json.dump(serie, open(dest + '.tmp', 'w'), separators=(',', ':'))
                os.replace(dest + '.tmp', dest)
                print(abr, pst, flush=True)
        if a.publicar and time.time() - ult_pub > a.publicar:
            publicar(dest)
            ult_pub = time.time()
        if finais == len(ABRS):
            if a.publicar:
                publicar(dest)
            print('totalização final: fim', flush=True)
            return
        time.sleep(a.intervalo)


if __name__ == '__main__':
    main()
