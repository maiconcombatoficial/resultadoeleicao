# Apuração 2026 · Santa Catarina

App web para acompanhar a apuração das **Eleições Gerais 2026** com os dados oficiais do TSE:

- **Presidente** — resultado do Brasil e de Santa Catarina
- **Senado SC** — 2 vagas em 2026
- **Deputado Federal SC** (16 vagas) e **Deputado Estadual SC** (40 vagas) — busca por nome/partido/número e visão por partido/federação
- **Governador SC** (bônus)

**📍 Municípios de SC:** em qualquer aba de Santa Catarina (e em Presidente → Santa Catarina), digite o nome de um município para ver a apuração só dele. A lista dos 295 municípios vem do TSE (`config/mun-e<eleição>-cm.json`) e o resultado de `dados/sc/sc<código TSE>-c<cargo>-e<eleição>-u.json`. O município escolhido fica salvo e vale para todas as abas.

**✔ Situação oficial do TSE:** quando o TSE marca os eleitos (ou fecha a totalização), cada candidato passa a mostrar a situação oficial — "✔ Eleito · conforme TSE" (com QP ou média), "Suplente · conforme TSE", "2º turno · conforme TSE" ou "Não eleito · conforme TSE" — e os selos de projeção e de chance saem de cena.

**🔄 Chance de reverter:** selo em cada candidato dizendo se, com as urnas que faltam, ainda dá para mudar a situação: ✅ Garantido / ❌ Sem chance (certeza matemática nos majoritários: a diferença é maior que todos os votos que faltam), 🛡️ Vaga segura, 👍 provável, ⚠️ em risco, 🔄 Pode reverter, ⏳ Reversão difícil, 📉 improvável. Nos deputados usa o próprio cálculo do TSE para achar quantos votos a mais (ou a menos) mudariam a vaga; a lógica está em `chances.js`. Votos que faltam = válidos apurados × seções que faltam ÷ seções apuradas.

**📅 Histórico (2012 a 2024):** a aba "📅 Histórico" traz, além de 2022, as eleições municipais de 2024, 2020, 2016 e 2012 (prefeito e vereador) e as eleições gerais de 2018 e 2014 em SC, com o mesmo detalhamento por zona, bairro, local e seção (escolha o ano e o município). Na ficha de cada candidato, "📜 Histórico eleitoral" mostra todas as eleições dele de 2012 a 2026 (ligadas pelo nome completo, aceitando sobrenome acrescentado). Dados gerados por `python3 scripts/gerar_ano.py --ano <ano>` a partir dos dados abertos do TSE (`votacao_candidato_munzona` e `votacao_secao`), em `dados<ano>/`. Os totais de cada eleição conferem com a soma das seções (votos de candidatos inaptos, que renunciaram ou foram cassados entram como nulos, como no TSE).

**📍 Meu território:** na aba 🏘️ Bairros, "Meu território" deixa uma liderança ou vereador marcar as escolas (locais de votação) ou seções onde trabalhou, em um ou mais municípios (salvo no aparelho). Para o candidato escolhido, mostra os votos "entregues" ali, o % dos válidos, a posição, quanto isso representa do total do candidato em SC, a comparação com 2022 nas mesmas seções e, opcionalmente, com a própria votação de vereador/prefeito em 2024, 2020 ou 2016. Card "Entreguei X votos para…" e planilha.

**📷 Ler boletim de urna (apuração paralela no aparelho):** na aba 🏘️ Bairros, "Ler boletim" lê o QR code impresso no boletim de urna de cada seção pela câmera (BarcodeDetector do navegador ou jsQR, Apache-2.0, em `lib/jsqr`), por uma foto ou colando o texto (ex.: do app Boletim na Mão). Junta as partes (`QRBU:i:n`) em qualquer ordem, confere a soma de cada cargo com o total impresso e compara a seção com o boletim publicado pelo TSE (✅ confere / ⚠️ diferente). Soma os votos das seções lidas por cargo, com card, CSV e Excel. Tudo fica no aparelho; o painel central para várias pessoas ficou para depois.

**🔗 Link direto:** o endereço acompanha o que está na tela — a ficha de um candidato, a comparação (2 ou 3 candidatos, até de cargos diferentes), o lugar escolhido em "Onde foi mais votado", a aba Bairros/Histórico com ano, município, zona, bairro, local e seção. O botão "🔗 Copiar link" (no topo da ficha e no explorador de seções) copia o endereço (no celular, abre o compartilhar); quem recebe cai direto na mesma tela. Ex.: `#depfed?c=<sq>&ca=depfed&vs=<sq>&va=depest`, `#h2022?ano=2024&m=81051`. A prévia no WhatsApp continua a geral do app (o GitHub Pages é estático).

**🏠 Início:** a aba de abertura reúne o andamento da apuração em SC, os seus candidatos acompanhados (❤️), Governador e Senado, as cadeiras de Dep. Federal e Estadual por partido (eleitos pelo TSE ou, antes disso, pela projeção), atalhos e um card "Compartilhar resumo de SC".

**⚖️ Comparar candidatos:** na ficha de qualquer candidato, "Comparar com outro candidato" mostra os dois lado a lado (votos, % dos válidos, posição, ganho na última atualização, quem está à frente e por quanto), se a diferença está aumentando ou diminuindo, gráficos com as duas evoluções e onde cada um é mais forte. Dá para incluir um **3º candidato** ("+ Comparar com mais um"): o placar mostra quantos lugares cada um venceu e cada linha traz o 1º, 2º e 3º. O outro candidato pode ser **de outro cargo** (ex.: Dep. Federal × Dep. Estadual, botões de cargo no topo da escolha). O cartão "📍 Onde a diferença foi maior" usa os votos dos boletins de urna já no app (`dados2026/municipios-*.json` e `dados2026/secoes`) e mostra, por município, associação (FECAM) ou região e, num lugar escolhido, por zona, bairro ou local: as duas barras lado a lado, quantos votos um teve a mais que o outro e em quantos lugares cada um ficou na frente, nas ordens "A na frente", "B na frente", "≈ Mais parecidos" (menor diferença proporcional) e "Mais votos"; com imagem, carrossel (capa + até 9 páginas) e CSV. Sem esses arquivos (ex.: Presidente fora de SC), vale a consulta ao TSE por município de antes.

**👤 Detalhes do candidato:** toque no nome (ou na linha/cartão) de qualquer candidato para abrir a ficha: votos, % dos válidos, posição, tendência (crescendo, caindo ou estável), gráficos de % e de votos ao longo da apuração, disputa com os vizinhos, situação na projeção, vice/suplentes e votos na Grande Florianópolis.

**★ Eleitos pela projeção (deputados):** o app aplica o cálculo do TSE aos votos já apurados e marca em destaque quem estaria eleito: quociente eleitoral (válidos ÷ vagas), quociente partidário com votos de legenda (mínimo de 10% do QE por candidato), sobras pela maior média com as exigências de 80%/20% do QE e, por fim, a fase final aberta a todos (STF, ADIs 7228/7263/7325). Código Eleitoral arts. 106–111 com a Lei 14.211/2021; lógica em `vagas.js`. Quando o TSE marca os eleitos oficiais, vale o que o TSE diz.

**📅 2022 por município, zona, local, bairro e seção:** na aba "📅 2022", escolha um município para ver o resultado de 2022 por zona, bairro, local de votação e seção; toque num candidato para ver os votos dele em cada um. Dados em `dados2022/secoes/<código TSE>.json` (TSE, `votacao_secao_2022_SC`), baixados só quando o município é aberto. Os dados de 2022 podem ser desligados em "ℹ️ Sobre → Preferências".

**ℹ️ Sobre:** criado e desenvolvido por **Maicon Combat** — [maiconcombat.com.br](https://maiconcombat.com.br) · Instagram [@maiconcombat](https://www.instagram.com/maiconcombat/).

**🏘️ 2026 por bairro, local e seção (boletins de urna):** aba "🏘️ Bairros": ao tocar num cargo, o candidato que você acompanha (❤️) naquele cargo já aparece em destaque (com atalhos para os outros acompanhados do mesmo cargo e uma busca por nome, partido ou número); em SC inteira, mostra os bairros onde ele foi mais votado; escolha o cargo e o município para ver o resultado do 1º turno por zona, bairro, local de votação e seção, com o candidato em destaque em cada linha: votos, % e a posição dele em cada zona, bairro, local e seção, ao lado do 1º colocado (🏆) e de quantos votos está atrás dele. Sem município, mostra o bairro mais forte de cada candidato. Na ficha de cada candidato, o cartão "Onde foi mais votado" (em SC: por município ou por bairro; num município ou região: por zona (cada zona abre a lista dos seus bairros, com 2022), bairro, local ou seção, com votos, % e posição do candidato, 2022 alinhado por município, zona e bairro, imagem e CSV — votos por município em `dados2026/municipios-<eleição>.json`) lista os bairros de SC (mais votos ou maior %) ou os de um município ou região, escolhidos pelos mesmos atalhos do app (busca, Grande Florianópolis, maiores cidades, mesorregiões e microrregiões; numa região, os bairros de todos os municípios dela são somados na mesma lista), e, quando os dados de 2022 estão ligados, a variação 2022 → 2026 em cada bairro: selo verde (alta de 20% ou mais), azul (alta), laranja (queda) ou vermelho (queda de 20% ou mais), barras 2022 × 2026, quantos bairros cresceram e caíram, e as ordenações "Mais cresceu" e "Mais caiu" (o candidato é ligado a 2022 pelo nome completo; vale o mesmo cargo de 2022 quando houver). Os votos vêm dos boletins de urna (BU) de cada uma das ~17,5 mil seções de SC, publicados pelo TSE em "Dados de urna" (`resultados.tse.jus.br/oficial/ele2026/arquivo-urna/3220/...`) e decodificados com a especificação ASN.1 do TSE (`bu.asn1`); o bairro de cada local vem do cadastro `eleitorado_local_votacao_2026` do TSE (em Florianópolis, a lista do TRE-SC). Arquivos em `dados2026/secoes/<código TSE>.json` e `dados2026/bairros-<eleição>.json`. Em 2022, o bairro de cada local agora vem de `eleitorado_local_votacao_2022`, para os 295 municípios.

**🎞️ Carrossel:** na ficha, o cartão "Onde foi mais votado" gera uma sequência de imagens (até 20, como um carrossel do Instagram), compartilhadas de uma vez: capa com o total e as zonas, e depois todos os bairros de cada zona (ou todas as linhas do nível escolhido), 6 por imagem, com 2022 × 2026 alinhados, variação, posição e número da página. Sem suporte a compartilhar vários arquivos, baixa as imagens uma a uma.

**🗺️ Mapa de votos aberto:** na ficha, o mapa mostra os votos do candidato por município (cor = variação desde 2022) ou, com um lugar escolhido em "Onde foi mais votado", por local de votação; na comparação, cada município ou local leva a cor de quem teve mais votos. Coordenadas públicas do cadastro de locais do TSE em `dados2026/locais-mapa.json` (`scripts/gerar_locais_mapa.py`).

**🧠 Análise do desempenho:** na ficha, um texto gerado automaticamente a partir dos números (sem IA paga): concentração da votação e redutos, maior reduto e posição, municípios onde foi o mais votado, onde tem mais peso, associações mais forte e mais fraca, bairro mais forte, evolução desde 2022 (municípios que subiram e caíram, maior alta e maior queda) e quem mais ganhou votos onde ele mais perdeu. Tem card próprio e entra no Relatório em PDF.

**📄 Relatório em PDF:** na ficha do candidato, "Relatório em PDF" junta numa só peça (A4, com cabeçalho, fonte e data) o desempenho, os municípios, as associações e os bairros onde foi mais votado; na comparação, o PDF traz o resumo e as páginas de "Onde a diferença foi maior". Usa jsPDF (MIT, em `lib/jspdf`), carregado só na hora.

**🎯 Metas de votos:** na ficha, defina metas por município, associação ou bairro (do lugar escolhido) — à mão ou "2022 (ou 2026) + X%" — e acompanhe meta × resultado com o % atingido (verde ≥ 100%, laranja 70–99%, vermelho abaixo). Salvo no aparelho; card e Excel.

**📊 Excel:** ao lado de cada CSV há o botão "Excel" (.xlsx com filtros e colunas ajustadas): na ficha, uma aba para municípios, associações e bairros (e o lugar escolhido); na comparação, uma aba por nível; no território e no explorador, a tabela da tela. Usa SheetJS (Apache-2.0, `lib/xlsx`), carregado só na hora.

**📸 Imagens para compartilhar e ⬇️ planilha:** o botão "📸 Compartilhar imagem" gera uma imagem 1080×1350 (formato do Instagram), com a foto e o @maiconcombat no rodapé, em: resultado de cada cargo (os 8 primeiros), ficha do candidato (números, 2022 e bairros mais fortes), comparação entre dois candidatos, bairros onde foi mais votado, explorador por zona/bairro/local/seção (mais votados aqui, ou onde o candidato em foco foi melhor) e, na área protegida, mapa de votos, perfil do eleitor, abstenção e transferência entre turnos (com o selo "Análise exclusiva"). No celular, abre o menu de compartilhar; no computador, baixa o PNG. O mesmo cartão e o explorador por zona, bairro, local e seção baixam a tabela em CSV no padrão do Excel em português (";", vírgula decimal, UTF-8).

**📲 Instalar como app (PWA):** `manifest.webmanifest`, ícones em `img/icones/` e um service worker (`sw.js`) que busca sempre a versão nova e só usa o cache sem internet; os dados ao vivo do TSE não passam por ele. Na aba "Sobre", um botão (Android/Chrome) ou as instruções (iPhone) para instalar.

**🔒 Análises (área protegida):** aba com login. Os dados ficam em `pro/*.bin`, criptografados com AES-256-GCM e comprimidos com gzip. A chave dos dados só se obtém com usuário e senha: `pro/usuarios.json` guarda, por usuário (identificado pelo hash do nome), a chave embrulhada com outra derivada da senha (PBKDF2-SHA256, 310 mil iterações). Nenhuma senha fica no código. A sessão pode ficar lembrada no aparelho; "Sair" apaga a chave.
- **🗺️ Mapa de votos:** em SC, um círculo por município; num município, um círculo por local de votação (coordenadas do cadastro do TSE). O tamanho é o número de votos do candidato e a cor é a variação desde 2022 (verde, azul, laranja, vermelho). A camada "Abstenção" pinta pelos quintis de abstenção dos locais. O mapa usa Leaflet (em `lib/leaflet/`) e o mapa base do OpenStreetMap (sem chave de API; reserva: mapa cinza da Esri), com uma tabela acessível dos mesmos números logo abaixo.
- **👥 Perfil do eleitor:** cruza o perfil do eleitorado por seção (TSE 2026: sexo, idade e escolaridade) com os boletins de urna. As seções são divididas em 5 grupos com o mesmo número de votos, por perfil, e o app mostra o % do candidato em cada grupo e frases como "vai melhor onde há mais eleitores com superior completo". É uma estimativa ecológica: compara seções, não pessoas.
- **🔀 1º → 2º turno:** estimativa de para onde foram os eleitores de cada candidato do 1º turno, seção a seção (mínimos quadrados com restrição: cada linha soma 100%, sem valores negativos). Já traz o governo de SC em 2022 e entra sozinha para 2026 quando os boletins do 2º turno forem processados.
- **📉 Abstenção, brancos e nulos:** por município ou por bairro (aptos e comparecimento dos boletins; o total confere com o TSE), com rankings de maior abstenção, mais ausentes, mais brancos e mais nulos por cargo.

**📐 Quociente eleitoral e partidário:** nas abas de deputados (SC inteira), um quadro sempre visível mostra o quociente eleitoral (válidos ÷ vagas), os mínimos de 10% e 80% do QE e cada partido/federação que atingiu o QE, com quantos quocientes fez e o quociente partidário (vagas diretas) + sobras. A tabela de partidos ganhou "QE" e a coluna "QP"; num município, aparece o QE de SC. Na ficha do deputado: o QE, quantos QE o partido fez, o QP, as vagas do partido, o % do QE do candidato e se ele passou dos 10% e 20% do QE. Na aba 2022, o quociente daquela eleição (calculado dos votos por seção, com legenda e sem os anulados).

**📅 2022 × 2026:** resultado oficial de 2022 em SC (Governador 1º e 2º turno, Senado, Deputado Federal e Estadual), com votos por município, em `dados2022/` (TSE, `votacao_candidato_munzona_2022`, via o espelho [f4llenz/tse-dados-abertos](https://github.com/f4llenz/tse-dados-abertos); totais conferidos com o resultado oficial). Na ficha de cada candidato de 2026: o que ele fez em 2022 (cargo, votos, %, posição, situação) e a variação até agora; na tabela por município/região, o % de 2022 ao lado do atual. Aba "📅 2022": resultado por cargo, onde estão os eleitos de 2022 na disputa de 2026 e os partidos de 2022 × 2026. Os candidatos são ligados pelo nome completo.

**🏘️ Bairros de Florianópolis:** ao escolher Florianópolis, cada zona eleitoral mostra um apelido (12ª · Centro e Continente, 13ª · Leste e Sul da Ilha, 100ª · Norte da Ilha), a lista oficial de bairros e os locais de votação (escola, bairro, seções e eleitores). Dá para buscar o bairro ("Campeche") no campo de município ou no quadro da zona. Dados em `floripa.js`: bairros de cada zona pelo PDF do TRE-SC ("bairros de abrangência das zonas eleitorais", após o rezoneamento); locais de votação pelo cadastro do TSE de 2026 (139 locais, 1.211 seções, 420.430 eleitores), com o bairro da lista de locais do TRE-SC quando o local já existia nela.

**⚡ Atalhos e regiões:** nas abas de SC, botões de um toque para Florianópolis e as cidades da Grande Florianópolis, as maiores cidades do estado e as regiões do IBGE (6 mesorregiões e 20 microrregiões) e as 21 associações de municípios da FECAM (AMESC, AMREC, AMUREL, GRANFPOLIS etc.). Escolher uma região ou associação soma os resultados dos municípios dela. Na ficha do candidato, "Maiores cidades" e "Todos os municípios + regiões" (agrupado por associação, região ou microrregião); no cartão "Onde foi mais votado" da ficha, o nível "Associações" soma os votos do candidato em cada associação, com posição e 2022. Dados de região e população em `regioes.js` (IBGE, via [mapaslivres/municipios-br](https://github.com/mapaslivres/municipios-br) e [betafcc/Municipios-Brasileiros-TSE](https://github.com/betafcc/Municipios-Brasileiros-TSE)); associações da FECAM pela "Lista de municípios por macrorregião, porte e associação" da Secretaria de Estado da Assistência Social de SC ([sas.sc.gov.br](https://www.sas.sc.gov.br)).

**🗺️ Zonas eleitorais:** depois de escolher um município, dá para escolher a zona eleitoral (lista de zonas do TSE em `mun-e<eleição>-cm.json`); o resultado vem de `dados/sc/sc<município>-z<zona>-c<cargo>-e<eleição>-u.json`. Na ficha do candidato, "Votos por município e zona" mostra os votos dele na Grande Florianópolis ou em todos os municípios de SC, e cada município pode ser aberto por zona.

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
| `#<aba>?c=<sq>&ca=<aba do cargo>` | abre a ficha do candidato (`vs`/`va` e `v3`/`v3a`: comparação; `l`: lugar dos bairros; `dl`: lugar da comparação) |
| `#<aba>?m=<município ou região>&z=<zona>` | abre a aba já num município (`r=br` para Brasil) |
| `#h2022?ano=2024&e=t1-c13&m=81051&b=<bairro>&lv=<local>&s=<seção>&f=<número>` | explorador de seções (também `#bairros?…`) |

## Fonte dos dados

`https://resultados.tse.jus.br/oficial/ele2026/{eleição}/dados/{uf}/{uf}-c{cargo}-e{eleição}-u.json`

| Eleição | Código 1º / 2º turno |
|---|---|
| Federal (Presidente) | 6257 / 6258 |
| Estadual (Governador, Senador, Deputados) | 6259 / 6260 |

Cargos: 1 Presidente, 3 Governador, 5 Senador, 6 Dep. Federal, 7 Dep. Estadual.
O TSE só publica os números após o fechamento das urnas em todo o país (17h de Brasília); antes disso o app mostra "aguardando divulgação".

Projeto independente, sem vínculo com a Justiça Eleitoral.

## Atualização automática (2º turno)

O workflow `.github/workflows/boletins.yml` roda sozinho na noite do 2º turno (25/10/2026) e de madrugada no dia 26. Também pode ser disparado à mão em **Actions → Boletins de urna → Run workflow**. Ele baixa os boletins de urna de SC, gera os dados por seção e bairro (`dados2026/`) e publica. A aba "🏘️ Bairros" e a ficha passam a mostrar o 2º turno sem mudança no código. Para refazer também a área protegida (mapa, perfil, abstenção e transferência do 2º turno), cadastre o segredo **`PRO_SENHA`** em *Settings → Secrets and variables → Actions*, com a senha de um usuário da área. Os scripts estão em `scripts/` (veja `scripts/README.md`).

## Testes automáticos

`npm test` abre o app num Chromium de celular (Playwright) e confere as telas principais: Início, cada aba, ficha com "Onde foi mais votado", relatório em PDF, comparação entre cargos, associações, Sobre, aviso de versão nova e prévia de link. Os dados do TSE usados nos testes ficam gravados em `tests/fixtures/tse` (regravar com `npm run test:gravar`), então o resultado não depende da internet. O workflow `.github/workflows/testes.yml` roda tudo em cada PR e em cada publicação na `main`.

Para rodar localmente: `npm ci && npx playwright install chromium && npm test`.

