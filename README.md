# Apuração 2026 · Santa Catarina

App web para acompanhar a apuração das **Eleições Gerais 2026** com os dados oficiais do TSE:

- **Presidente** — resultado do Brasil e de Santa Catarina
- **Senado SC** — 2 vagas em 2026
- **Deputado Federal SC** (16 vagas) e **Deputado Estadual SC** (40 vagas) — busca por nome/partido/número e visão por partido/federação
- **Governador SC** (bônus)

Atualiza sozinho a cada 30 s, mostra o percentual de seções totalizadas, comparecimento, brancos/nulos,
quantos votos cada candidato ganhou desde a última atualização e marca eleitos / 2º turno conforme o TSE.

## Como usar

É um site estático (HTML + CSS + JS, sem build). O navegador consulta o TSE diretamente (o TSE libera CORS).

```bash
python3 -m http.server 8000
# abra http://localhost:8000
```

Para publicar: GitHub Pages (Settings → Pages → branch `main`, pasta `/`), Netlify, Vercel ou qualquer hospedagem estática.

Parâmetros de URL:

| Parâmetro | Efeito |
|---|---|
| `?demo=1` | dados **fictícios** para ver o app funcionando antes da divulgação |
| `?turno=2` | 2º turno (Presidente e Governador; Senado e Deputados continuam no 1º) |
| `?base=https://…` | troca a URL base do TSE (ex.: um proxy próprio) |
| `#presidente`, `#senador`, `#depfed`, `#depest`, `#governador` | abre direto numa aba |

## Fonte dos dados

`https://resultados.tse.jus.br/oficial/ele2026/{eleição}/dados/{uf}/{uf}-c{cargo}-e{eleição}-u.json`

| Eleição | Código 1º / 2º turno |
|---|---|
| Federal (Presidente) | 6257 / 6258 |
| Estadual (Governador, Senador, Deputados) | 6259 / 6260 |

Cargos: 1 Presidente, 3 Governador, 5 Senador, 6 Dep. Federal, 7 Dep. Estadual.
O TSE só publica os números após o fechamento das urnas em todo o país (17h de Brasília); antes disso o app mostra "aguardando divulgação".

Projeto independente, sem vínculo com a Justiça Eleitoral.
