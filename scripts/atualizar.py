"""Atualiza os dados por seção e bairro de um turno: baixa os boletins de urna, gera bairros e (se houver chave) a área protegida.

Uso: python3 scripts/atualizar.py --turno 2      (PRO_CHAVE no ambiente para refazer a área protegida)
"""
import argparse, os, subprocess, sys
from baixar_boletins import escolher_pleito

ap = argparse.ArgumentParser()
ap.add_argument('--turno', type=int, default=2)
a = ap.parse_args()
pleito = escolher_pleito(a.turno)
if not pleito:
    print(f'O pleito do {a.turno}º turno ainda não está no TSE; nada a fazer.')
    sys.exit(0)
aqui = os.path.dirname(os.path.abspath(__file__))
roda = lambda *args: subprocess.run([sys.executable, os.path.join(aqui, args[0]), *args[1:]], check=True)
roda('baixar_boletins.py', '--turno', str(a.turno), '--pleito', str(pleito))
pasta = os.path.join(os.path.dirname(aqui), '.cache', 'bu', str(pleito))
if not os.path.isdir(pasta) or not any(f.endswith('.bu') for f in os.listdir(pasta)):
    print('Nenhum boletim publicado ainda; nada a fazer.')
    sys.exit(0)
roda('gerar_bairros.py', '--ano', '2026', '--turno', str(a.turno), '--pleito', str(pleito))
if os.environ.get('PRO_CHAVE') or os.environ.get('PRO_SENHA'):
    roda('gerar_pro.py')
else:
    print('Sem PRO_CHAVE: área protegida não foi atualizada.')
