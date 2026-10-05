"""Estimativa de transferência de votos entre o 1º e o 2º turno, seção a seção.

Para cada seção s, x_s = fatias do 1º turno (candidatos, brancos/nulos) e y_s = fatias do 2º turno.
Procura a matriz T (linhas somam 1, sem valores negativos) que minimiza Σ n_s ‖x_s·T − y_s‖²:
mínimos quadrados com restrição, resolvidos por gradiente projetado (sem dependências externas).
É uma estimativa ecológica: compara seções, não eleitores.
"""


def _projeta_simplex(v):
    u = sorted(v, reverse=True)
    acc, rho, theta = 0.0, 0, 0.0
    for i, x in enumerate(u):
        acc += x
        t = (acc - 1) / (i + 1)
        if x - t > 0:
            rho, theta = i, t
    return [max(0.0, x - theta) for x in v]


def estimar(secoes, origens, destinos, iteracoes=4000):
    """secoes: lista de (n, x[len(origens)], y[len(destinos)]) com x e y em proporções."""
    k, m = len(origens), len(destinos)
    A = [[0.0] * k for _ in range(k)]
    B = [[0.0] * m for _ in range(k)]
    for n, x, y in secoes:
        for i in range(k):
            if not x[i]:
                continue
            for j in range(k):
                A[i][j] += n * x[i] * x[j]
            for j in range(m):
                B[i][j] += n * x[i] * y[j]
    # passo: 1 / maior autovalor de A (iteração de potência)
    v = [1.0] * k
    lam = 1.0
    for _ in range(100):
        w = [sum(A[i][j] * v[j] for j in range(k)) for i in range(k)]
        lam = max(abs(x) for x in w) or 1.0
        v = [x / lam for x in w]
    passo = 1.0 / lam
    T = [[1.0 / m] * m for _ in range(k)]
    for _ in range(iteracoes):
        G = [[sum(A[i][l] * T[l][j] for l in range(k)) - B[i][j] for j in range(m)] for i in range(k)]
        T = [_projeta_simplex([T[i][j] - passo * G[i][j] for j in range(m)]) for i in range(k)]
    return T


def de_arquivos(arquivos, el1, el2, max_origens=6):
    """Monta as seções a partir dos arquivos de seções (votos [nr, v, …]) e estima a matriz.
    Origens: os candidatos mais votados no 1º turno + 'Outros' + 'Brancos e nulos'. Destinos: os do 2º turno + 'Brancos e nulos'."""
    from collections import Counter
    tot1, tot2 = Counter(), Counter()
    pares = []
    for arq in arquivos:
        v1, v2 = arq['votos'].get(el1, {}), arq['votos'].get(el2, {})
        for zs, a1 in v1.items():
            a2 = v2.get(zs)
            if not a2:
                continue
            c1 = Counter(); c2 = Counter()
            for i in range(0, len(a1), 2):
                c1[96 if a1[i] in (95, 96, 97) else a1[i]] += a1[i + 1]
            for i in range(0, len(a2), 2):
                c2[96 if a2[i] in (95, 96, 97) else a2[i]] += a2[i + 1]
            tot1.update(c1); tot2.update(c2)
            pares.append((c1, c2))
    top = [nr for nr, _ in tot1.most_common() if nr != 96][:max_origens]
    origens = top + ['outros', 96]
    destinos = [nr for nr, _ in tot2.most_common() if nr != 96] + [96]
    secoes = []
    for c1, c2 in pares:
        n1, n2 = sum(c1.values()), sum(c2.values())
        if not n1 or not n2:
            continue
        x = [c1.get(o, 0) / n1 for o in top] + [sum(v for nr, v in c1.items() if nr not in top and nr != 96) / n1, c1.get(96, 0) / n1]
        y = [c2.get(d, 0) / n2 for d in destinos]
        secoes.append(((n1 + n2) / 2, x, y))
    T = estimar(secoes, origens, destinos)
    return {'origens': origens, 'destinos': destinos, 'T': [[round(v, 4) for v in linha] for linha in T],
            'votos1': [tot1.get(o, 0) if o != 'outros' else sum(v for nr, v in tot1.items() if nr not in top and nr != 96) for o in origens],
            'votos2': [tot2.get(d, 0) for d in destinos], 'secoes': len(secoes)}
