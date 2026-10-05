"""Funções comuns aos scripts de geração de dados do app (boletins de urna, locais de votação)."""
import csv, json, os, re, ssl, time, unicodedata, urllib.request, zipfile, io

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(RAIZ, '.cache')
TSE = 'https://resultados.tse.jus.br/oficial'
CDN = 'https://cdn.tse.jus.br/estatistica/sead/odsele'
CARGOS = {'presidente': 1, 'governador': 3, 'senador': 5, 'deputadoFederal': 6, 'deputadoEstadual': 7}
_ctx = None


def contexto_ssl():
    global _ctx
    if _ctx is None:
        ca = '/root/.ccr/ca-bundle.crt'
        _ctx = ssl.create_default_context(cafile=ca) if os.path.exists(ca) else ssl.create_default_context()
    return _ctx


def baixar(url, tentativas=5, timeout=60):
    """Conteúdo da URL; None se 404."""
    for i in range(tentativas):
        try:
            with urllib.request.urlopen(url, context=contexto_ssl(), timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(2 ** i)
        except Exception:
            time.sleep(2 ** i)
    raise RuntimeError(f'falhou: {url}')


def baixar_json(url):
    b = baixar(url)
    return json.loads(b) if b else None


def chave_nome(t):
    return re.sub(r'[^a-z]', '', unicodedata.normalize('NFD', (t or '').lower()).encode('ascii', 'ignore').decode())


def limpar_bairro(b):
    b = re.sub(r'\s+', ' ', (b or '').strip().strip('-').strip())
    if not b or b in ('-', '.', 'NAO INFORMADO', 'NÃO INFORMADO', '#NULO#', '#NE#'):
        return ''
    MIN = {'DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'EM'}
    return ' '.join(w.lower() if i and w in MIN else w.capitalize() for i, w in enumerate(b.split(' ')))


def arquivo_cadastro(ano, uf='SC'):
    """CSV do cadastro de locais de votação (eleitorado_local_votacao_<ano>), baixado uma vez para .cache/."""
    os.makedirs(CACHE, exist_ok=True)
    destino = os.path.join(CACHE, f'eleitorado_local_votacao_{ano}_{uf}.csv')
    if not os.path.exists(destino):
        z = zipfile.ZipFile(io.BytesIO(baixar(f'{CDN}/eleitorado_locais_votacao/eleitorado_local_votacao_{ano}.zip', timeout=600)))
        nomes = [n for n in z.namelist() if n.endswith(f'_{uf}.csv')] or [n for n in z.namelist() if n.endswith('.csv')]
        with z.open(nomes[0]) as f, open(destino, 'wb') as out:
            if nomes[0].endswith(f'_{uf}.csv'):
                out.write(f.read())
            else:  # arquivo único do Brasil: filtra a UF
                for i, linha in enumerate(f):
                    if i == 0 or f';"{uf}";'.encode() in linha:
                        out.write(linha)
    return destino


def ler_locais(ano, turno=1, uf='SC'):
    """(cd_mun, 'z-loc') -> [nome, endereço, bairro, lat, lon]; (cd_mun, 'z-s') -> 'z-loc'; agregadas -> principal."""
    locais, secoes, principal = {}, {}, {}
    with open(arquivo_cadastro(ano, uf), encoding='latin1', newline='') as f:
        for r in csv.DictReader(f, delimiter=';'):
            if r['SG_UF'] != uf or str(r['AA_ELEICAO']) != str(ano) or str(r['NR_TURNO']) != str(turno):
                continue
            cd = r['CD_MUNICIPIO'].zfill(5)
            z = str(int(r['NR_ZONA']))
            k = f"{z}-{int(r['NR_LOCAL_VOTACAO'])}"
            zs = f"{z}-{int(r['NR_SECAO'])}"
            locais[(cd, k)] = [r['NM_LOCAL_VOTACAO'].strip(), r['DS_ENDERECO'].strip(), limpar_bairro(r['NM_BAIRRO']), r['NR_LATITUDE'], r['NR_LONGITUDE']]
            secoes[(cd, zs)] = k
            if r.get('DS_TIPO_SECAO_AGREGADA') == 'Agregada':
                principal[(cd, zs)] = f"{z}-{int(r['NR_SECAO_PRINCIPAL'])}"
    if not locais and turno != 1:  # o cadastro pode trazer só o 1º turno
        return ler_locais(ano, 1, uf)
    return locais, secoes, principal


def bairros_floripa(ano):
    """Bairro de cada local de Florianópolis pela lista do TRE-SC (2022: PDF; 2026: floripa.js)."""
    if ano == 2022:
        return json.load(open(os.path.join(RAIZ, 'scripts', 'floripa_bairros_2022.json')))
    src = open(os.path.join(RAIZ, 'floripa.js'), encoding='utf-8').read()
    F = json.loads(src[src.index('{'):src.rindex('}') + 1])
    return {f"{l['z']}-{l['cod']}": l['bairro'] for l in F['locais']}


def pleitos(ciclo='ele2026'):
    """Pleitos do ciclo, com as eleições e o turno de cada uma (config do TSE)."""
    j = baixar_json(f'{TSE}/comum/config/ele-c.json')
    out = []
    for p in j['pl']:
        if p.get('c') != ciclo:
            continue
        els = {int(e['cd']): int(e['t']) for e in p['e']}
        out.append({'cd': int(p['cd']), 'dt': p['dt'], 'eleicoes': els, 'turno': max(els.values()) if els else 1})
    return out


_bu = None


def decodificador():
    global _bu
    if _bu is None:
        import asn1tools
        _bu = asn1tools.compile_files(os.path.join(RAIZ, 'scripts', 'spec', 'bu.asn1'), codec='ber')
    return _bu


def ler_bu(caminho, turno):
    """Decodifica um boletim de urna: seção, local, aptos, comparecimento e votos por cargo ('t<turno>-c<cargo>')."""
    C = decodificador()
    env = C.decode('EntidadeEnvelopeGenerico', open(caminho, 'rb').read())
    bu = C.decode('EntidadeBoletimUrna', env['conteudo'])
    ids = bu['identificacaoSecao']
    out = {'mun': str(ids['municipioZona']['municipio']).zfill(5), 'zona': ids['municipioZona']['zona'], 'local': ids['local'], 'secao': ids['secao'],
           'votos': {}, 'aptos': 0, 'comp': 0}
    ncargos = -1
    for rel in bu['resultadosVotacaoPorEleicao']:
        # aptos/comparecimento da eleição com mais cargos (a estadual no 1º turno), como o TSE divulga
        n = sum(len(rv['totaisVotosCargo']) for rv in rel['resultadosVotacao'])
        if n > ncargos:
            ncargos = n
            out['aptos'] = rel['qtdEleitoresAptos']
            out['comp'] = max((rv['qtdComparecimento'] for rv in rel['resultadosVotacao']), default=0)
        for rv in rel['resultadosVotacao']:
            for tc in rv['totaisVotosCargo']:
                cod = tc['codigoCargo']
                cargo = CARGOS.get(cod[1]) if cod[0] == 'cargoConstitucional' else None
                if not cargo:
                    continue
                arr = []
                for vv in tc['votosVotaveis']:
                    t = vv['tipoVoto']
                    nr = 95 if t == 'branco' else 96 if t == 'nulo' else vv['identificacaoVotavel']['codigo'] if t in ('nominal', 'legenda') else 97
                    arr += [nr, vv['quantidadeVotos']]
                out['votos'][f't{turno}-c{cargo}'] = arr
    return out
