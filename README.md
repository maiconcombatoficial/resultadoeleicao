# Apuração 2026 · Santa Catarina

App web para acompanhar a apuração das **Eleições Gerais 2026** com os dados oficiais do TSE:

- **Presidente** — resultado do Brasil e de Santa Catarina
- **Senado SC** — 2 vagas em 2026
- **Deputado Federal SC** (16 vagas) e **Deputado Estadual SC** (40 vagas) — busca por nome/partido/número e visão por partido/federação
- **Governador SC** (bônus)

**📍 Municípios de SC:** em qualquer aba de Santa Catarina (e em Presidente → Santa Catarina), digite o nome de um município para ver a apuração só dele. A lista dos 295 municípios vem do TSE (`config/mun-e<eleição>-cm.json`) e o resultado de `dados/sc/sc<código TSE>-c<cargo>-e<eleição>-u.json`. O município escolhido fica salvo e vale para todas as abas.

**★ Eleitos pela projeção (deputados):** o app aplica o cálculo do TSE aos votos já apurados e marca em destaque quem estaria eleito: quociente eleitoral (válidos ÷ vagas), quociente partidário com votos de legenda (mínimo de 10% do QE por candidato), sobras pela maior média com as exigências de 80%/20% do QE e, por fim, a fase final aberta a todos (STF, ADIs 7228/7263/7325). Código Eleitoral arts. 106–111 com a Lei 14.211/2021; lógica em `vagas.js`. Quando o TSE marca os eleitos oficiais, vale o que o TSE diz.

**📊 Municípios:** percentual de seções apuradas em cada um dos 295 municípios de SC, com destaque para Florianópolis e a Grande Florianópolis (núcleo e área de expansão da região metropolitana). A região atualiza a cada 30 s; os demais municípios a cada 3 min (no máximo 6 consultas simultâneas, e quem chegou a 100% não é consultado de novo).

**❤️ Acompanhados:** toque no coração ao lado de qualquer candidato para acompanhá-lo numa aba própria, com posição, votos, distância para o candidato de cima e de baixo, situação em relação às vagas e um gráfico da evolução dos votos ao longo da apuração. A lista fica salva no próprio aparelho.

Tudo colorido com as cores de cada partido: barra de divisão dos votos (com a linha dos 50%), semicírculo da bancada eleita, filtros por partido e dicas ao tocar nas cores.

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
| `#favoritos`, `#municipios`, `#presidente`, `#senador`, `#depfed`, `#depest`, `#governador` | abre direto numa aba |

## Fonte dos dados

`https://resultados.tse.jus.br/oficial/ele2026/{eleição}/dados/{uf}/{uf}-c{cargo}-e{eleição}-u.json`

| Eleição | Código 1º / 2º turno |
|---|---|
| Federal (Presidente) | 6257 / 6258 |
| Estadual (Governador, Senador, Deputados) | 6259 / 6260 |

Cargos: 1 Presidente, 3 Governador, 5 Senador, 6 Dep. Federal, 7 Dep. Estadual.
O TSE só publica os números após o fechamento das urnas em todo o país (17h de Brasília); antes disso o app mostra "aguardando divulgação".

Projeto independente, sem vínculo com a Justiça Eleitoral.
