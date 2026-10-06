import { test, expect, baixar } from './apoio.js'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
})

test('Início abre por padrão com o resumo de SC', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-aba="inicio"][aria-selected="true"]')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Eleições 2026 · Santa Catarina' })).toBeVisible()
  await expect(page.locator('.painel-cadeiras')).toHaveCount(2)
  const img = await baixar(page, page.locator('[data-card="painel"]'))
  expect(img.nome).toMatch(/\.png$/)
  expect(img.bytes).toBeGreaterThan(30_000)
})

for (const aba of ['depfed', 'depest', 'governador', 'senador', 'municipios', 'bairros', 'h2022', 'sobre']) {
  test(`aba ${aba} abre sem erro`, async ({ page }) => {
    await page.goto(`/#${aba}`)
    await expect(page.locator(`[data-aba="${aba}"][aria-selected="true"]`)).toBeVisible()
    await expect(page.locator('#conteudo .cartao').first()).toBeVisible()
    await expect(page.locator('#status')).not.toHaveClass(/carregando/, { timeout: 30_000 })
    await expect(page.locator('#status')).not.toHaveClass(/erro/)
    await expect(page.locator('#conteudo .esq')).toHaveCount(0)
    if (['depfed', 'depest', 'governador', 'senador'].includes(aba)) await expect(page.locator('#conteudo [data-cand]').first()).toBeVisible()
  })
}

test('ficha: onde foi mais votado, associações e ordem por crescimento', async ({ page }) => {
  await page.goto('/#depfed')
  await page.locator('[data-cand]').first().click()
  const card = page.locator('.cartao.bai')
  await expect(card).toBeVisible()
  await card.locator('[data-bai-grupo="assoc"]').click()
  await expect(card.locator('.cmp-linha, .cand-meta').first()).toBeVisible()
  await card.locator('[data-bai-grupo="mun"]').click()
  await expect(card).toContainText('Votou em')
  const img = await baixar(page, card.locator('[data-card]').first())
  expect(img.bytes).toBeGreaterThan(30_000)
})

test('relatório em PDF da ficha', async ({ page }) => {
  await page.goto('/#depest')
  await page.locator('[data-cand]').first().click()
  await expect(page.locator('[data-relatorio]')).toBeVisible()
  const pdf = await baixar(page, page.locator('[data-relatorio]'))
  expect(pdf.nome).toMatch(/^relatorio-.*\.pdf$/)
  expect(pdf.bytes).toBeGreaterThan(200_000)
})

test('comparação entre cargos: Dep. Federal × Dep. Estadual', async ({ page }) => {
  await page.goto('/#depfed')
  await page.locator('[data-cand]').first().click()
  await page.locator('[data-comparar]').click()
  await page.locator('[data-comp-cargo="depest"]').click()
  await page.locator('[data-comp-sq]').first().click()
  await expect(page.locator('.comp-cargo')).toHaveCount(2)
  const dif = page.locator('.cartao.cdif')
  await expect(dif.locator('.comp-placar')).toContainText('na frente em')
  for (const modo of ['w1', 'eq', 'v', 'w0']) await dif.locator(`[data-cd-modo="${modo}"]`).click()
  await dif.locator('[data-cd-grupo="assoc"]').click()
  await expect(dif.locator('.cmp-linha').first()).toBeVisible()
  const csv = await baixar(page, dif.locator('[data-cd-csv]'))
  expect(csv.nome).toMatch(/\.csv$/)
  const pdf = await baixar(page, dif.locator('[data-cd-pdf]'))
  expect(pdf.nome).toMatch(/\.pdf$/)
})

test('associações aparecem nas abas de SC e na busca', async ({ page }) => {
  await page.goto('/#depest')
  await expect(page.locator('.assoc-chips [data-regiao]')).toHaveCount(21)
  await page.locator('.assoc-chips [data-regiao="assoc:AMVE"]').click()
  await expect(page.locator('.resumo h2').first()).toContainText('AMVE · Vale Europeu (14 municípios)')
})

test('Sobre traz metodologia, privacidade e versão', async ({ page }) => {
  await page.goto('/#sobre')
  await expect(page.getByRole('heading', { name: /Como os números são calculados/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Privacidade/ })).toBeVisible()
  await expect(page.getByText(/^Versão /)).toBeVisible()
})

test('aviso de versão nova', async ({ page }) => {
  await page.route(/\?checar=/, async (r) => {
    const res = await r.fetch()
    r.fulfill({ status: 200, body: (await res.text()).replace(/app\.js\?v=\d+/, 'app.js?v=209912312359'), headers: { 'content-type': 'text/html' } })
  })
  await page.goto('/#sobre')
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.locator('#versao-nova')).toContainText('Nova versão')
})

test('prévia de link: meta tags e imagem', async ({ page, request }) => {
  await page.goto('/')
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /img\/og\.jpg$/)
  expect((await request.get('/img/og.jpg')).ok()).toBeTruthy()
  for (const i of ['icone-192.png', 'icone-512.png', 'icone-maskable-512.png', 'favicon-32.png']) expect((await request.get(`/img/icones/${i}`)).ok()).toBeTruthy()
})

test('histórico: 2024 municipal, 2018 e série do candidato', async ({ page }) => {
  await page.goto('/#h2022')
  await page.locator('[data-h22-ano="2024"]').click()
  await expect(page.locator('.resumo h2').first()).toContainText('Eleições 2024 · Vereador · SC')
  await page.locator('[data-h22-mun="81051"]').first().click()
  await expect(page.locator('.resumo h2').first()).toContainText('Florianópolis')
  await page.locator('[data-h22-ano="2018"]').click()
  await expect(page.locator('.resumo h2').first()).toContainText('Eleições 2018')
  await page.locator('[data-h22-ano="2014"]').click()
  await expect(page.locator('.resumo h2').first()).toContainText('Eleições 2014')
  await page.locator('[data-h22-ano="2012"]').click()
  await expect(page.locator('.resumo h2').first()).toContainText('Eleições 2012')
  await page.goto('/#depest')
  await page.locator('[data-cand]').first().click()
  await expect(page.locator('.historico li')).toHaveCount(3)
  await expect(page.locator('.historico')).toContainText('2018')
})

test('meu território: escolas marcadas somam os votos do candidato', async ({ page }) => {
  await page.goto('/#bairros')
  await page.locator('[data-h22="t1-c6"]').click()
  await page.locator('[data-b26-modo="territorio"]').click()
  await page.fill('#terr-mun', 'florian')
  await page.locator('[data-terr-cd="81051"]').first().click()
  await page.locator('[data-terr-local="81051|12-2097"]').click()
  await page.locator('[data-terr-local="81051|12-1813"]').click()
  await page.fill('#b26-busca', 'zanatta')
  await page.locator('[data-b26-cand]').first().click()
  await expect(page.locator('.terr-res .fav-nums')).toContainText('566')
  const img = await baixar(page, page.locator('[data-card="territorio"]'))
  expect(img.bytes).toBeGreaterThan(30_000)
})

test('comparação com 3 candidatos', async ({ page }) => {
  await page.goto('/#depfed')
  await page.locator('[data-cand]').first().click()
  await page.locator('[data-comparar]').click()
  await page.locator('[data-comp-cargo="depest"]').click()
  await page.locator('[data-comp-sq]').first().click()
  await page.locator('[data-comp-add3]').click()
  await page.locator('[data-comp-sq]').first().click()
  await expect(page.locator('.comp-tabela.tres')).toBeVisible()
  const dif = page.locator('.cartao.cdif')
  await expect(dif.locator('.comp-placar > span[style]')).toHaveCount(3)
  await dif.locator('[data-cd-modo="w2"]').click()
  await expect(dif.locator('.cmp-linha').first()).toContainText('1º')
  const img = await baixar(page, dif.locator('[data-card]'))
  expect(img.bytes).toBeGreaterThan(30_000)
})

test('análise automática na ficha', async ({ page }) => {
  await page.goto('/#depfed')
  await page.locator('[data-cand]').first().click()
  await expect(page.locator('.analise li').first()).toContainText('municípios')
  await expect(page.locator('.analise')).toContainText('Maior reduto')
  const img = await baixar(page, page.locator('[data-card="analise"]'))
  expect(img.bytes).toBeGreaterThan(30_000)
})

test('mapa de votos aberto na ficha e na comparação', async ({ page }) => {
  await page.goto('/#depfed')
  await page.locator('[data-cand]').first().click()
  await expect(page.locator('[data-mapa] .leaflet-interactive, [data-mapa] canvas').first()).toBeAttached({ timeout: 30_000 })
  await page.locator('[data-comparar]').click()
  await page.locator('[data-comp-cargo="depest"]').click()
  await page.locator('[data-comp-sq]').first().click()
  await expect(page.locator('.cdif [data-mapa] .leaflet-interactive, .cdif [data-mapa] canvas').first()).toBeAttached({ timeout: 30_000 })
})

test('planilha Excel da ficha e da comparação', async ({ page }) => {
  await page.goto('/#depfed')
  await page.locator('[data-cand]').first().click()
  const f = await baixar(page, page.locator('[data-bai-xlsx]'))
  expect(f.nome).toMatch(/\.xlsx$/)
  expect(f.bytes).toBeGreaterThan(5_000)
  await page.locator('[data-comparar]').click()
  await page.locator('[data-comp-cargo="depest"]').click()
  await page.locator('[data-comp-sq]').first().click()
  const c = await baixar(page, page.locator('[data-cd-xlsx]'))
  expect(c.nome).toMatch(/\.xlsx$/)
})

test('metas de votos: preencher, editar e manter salvo', async ({ page }) => {
  await page.goto('/#depest')
  await page.locator('[data-cand]').nth(3).click()
  const m = page.locator('.cartao.metas')
  await m.locator('#meta-pct').fill('20')
  await m.locator('[data-meta-auto]').click()
  await expect(m.locator('.meta-total')).toContainText('%')
  const inp = m.locator('.meta-inp').first()
  await inp.fill('30000')
  await inp.dispatchEvent('change')
  await expect(page.locator('.meta-linha').first().locator('.meta-pct')).toBeVisible()
  await page.reload()
  await page.goto('/#depest')
  await page.locator('[data-cand]').nth(3).click()
  await expect(page.locator('.cartao.metas .meta-total')).toBeVisible()
})

test('leitura do QR do boletim de urna: partes fora de ordem e conferência com o TSE', async ({ page }) => {
  await page.goto('/#bairros')
  await page.locator('[data-b26-modo="qr"]').click()
  await page.setInputFiles('#qr-foto', 'tests/fixtures/qr/p2.png')
  await expect(page.locator('.qr-msg')).toContainText('Falta a parte 1')
  await page.setInputFiles('#qr-foto', 'tests/fixtures/qr/p1.png')
  await expect(page.locator('.qr-msg')).toContainText('Seção lida')
  await expect(page.locator('.qr-secoes li').first()).toContainText('confere com o TSE')
  await expect(page.locator('.qr-ranking li').first()).toContainText('JULIA ZANATTA')
})

test('link direto: ficha, comparação, lugar e histórico abrem pelo endereço', async ({ page, context }) => {
  // reabre o endereço do zero, como quem recebeu o link
  const reabrir = async (url) => (await page.goto('about:blank'), await page.goto(url))
  await page.goto('/#depfed')
  await page.locator('[data-cand]').first().click()
  const nome = (await page.locator('.det-id h2').textContent()).trim()
  await expect(page).toHaveURL(/#depfed\?c=\d+&ca=depfed/)
  const urlFicha = page.url()
  // voltar fecha a ficha e tira o candidato do endereço
  await page.goBack()
  await expect(page.locator('.detalhe')).toBeHidden()
  await expect(page).toHaveURL(/#depfed$/)
  await reabrir(urlFicha)
  await expect(page.locator('.det-id h2')).toHaveText(nome)
  // comparação entre cargos
  await page.locator('[data-comparar]').click()
  await page.locator('[data-comp-cargo="depest"]').click()
  await page.locator('[data-comp-sq]').first().click()
  await expect(page.locator('.comp-cargo')).toHaveCount(2)
  await expect(page).toHaveURL(/&vs=\d+&va=depest/)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.locator('[data-copiar-link]').click()
  await expect(page.locator('[data-copiar-link]')).toContainText('Link copiado')
  const copiado = await page.evaluate(() => navigator.clipboard.readText())
  expect(copiado).toBe(page.url())
  await reabrir(copiado)
  await expect(page.locator('.comp-cargo')).toHaveCount(2)
  await expect(page.locator('.cartao.cdif .comp-placar')).toContainText('na frente em')
  // lugar escolhido na ficha
  await reabrir(urlFicha)
  await page.locator('.cartao.bai [data-bai-painel]').click()
  const lugar = page.locator('.cartao.bai .bai-atalhos [data-bai-lugar]').first()
  const id = await lugar.getAttribute('data-bai-lugar')
  await lugar.click()
  await expect(page).toHaveURL(new RegExp(`&l=${encodeURIComponent(id)}`))
  const nomeLugar = (await page.locator('.cartao.bai .bai-escolha .atalho.ativo').last().textContent()).replace('📍', '').trim()
  await reabrir(page.url())
  await expect(page.locator('.cartao.bai .bai-escolha')).toContainText(nomeLugar)
  // histórico: ano e município
  await reabrir('/#h2022?ano=2024&m=81051')
  await expect(page.locator('.resumo h2').first()).toContainText('Eleições 2024')
  await expect(page.locator('.resumo h2').first()).toContainText('Florianópolis')
})

test('busca única: candidatos de 2026 e anteriores, municípios, associações e bairros', async ({ page }) => {
  await page.goto('/#inicio')
  await page.keyboard.press('/')
  const caixa = page.locator('.busca-global')
  await expect(caixa).toBeVisible()
  await page.locator('#bg-input').fill('zanatta')
  await expect(caixa.locator('[data-bg-grupo^="Candidatos 2026"]')).toContainText('JULIA ZANATTA')
  await expect(caixa.locator('[data-bg-grupo^="Eleições anteriores"]')).toContainText('2022')
  // Enter abre o primeiro resultado (a ficha de 2026)
  await page.keyboard.press('Enter')
  await expect(caixa).toBeHidden()
  await expect(page.locator('.det-id h2')).toHaveText('JULIA ZANATTA')
  await page.goBack()
  // município: resultado e atalho para os bairros
  await page.locator('#buscar-tudo').click()
  await page.locator('#bg-input').fill('itajai')
  const mun = caixa.locator('[data-bg-grupo^="Municípios"]')
  await expect(mun).toContainText('Itajaí')
  await mun.locator('.bg-extra').first().click()
  await expect(page.locator('[data-aba="bairros"][aria-selected="true"]')).toBeVisible()
  await expect(page).toHaveURL(/#bairros\?m=81612/)
  // associação
  await page.locator('#buscar-tudo').click()
  await page.locator('#bg-input').fill('amfri')
  await caixa.locator('[data-bg-grupo^="Associações"]').locator('a').first().click()
  await expect(page).toHaveURL(/m=assoc%3AAMFRI/)
  await expect(page.locator('#conteudo')).toContainText('AMFRI')
  // bairro
  await page.locator('#buscar-tudo').click()
  await page.locator('#bg-input').fill('campeche')
  const bai = caixa.locator('[data-bg-grupo^="Bairros"]')
  await expect(bai).toContainText('Florianópolis')
  await bai.locator('a').first().click()
  await expect(page).toHaveURL(/#bairros\?m=81051&b=/)
  await expect(page.locator('.migalhas')).toContainText('Campeche')
  // eleição anterior abre no Histórico
  await page.locator('#buscar-tudo').click()
  await page.locator('#bg-input').fill('topazio silveira')
  const ant = caixa.locator('[data-bg-grupo^="Eleições anteriores"]')
  await expect(ant).toContainText('2024')
  await ant.locator('a').first().click()
  await expect(page.locator('[data-aba="h2022"][aria-selected="true"]')).toBeVisible()
  await expect(page.locator('.resumo h2').first()).toContainText('Florianópolis')
})

test('imagens no formato Stories 9:16', async ({ page }) => {
  await page.goto('/#depfed')
  await page.locator('[data-cand]').first().click()
  const fmt = page.locator('.det-cabeca [data-fmt-card]').first()
  await expect(fmt).toHaveAttribute('aria-pressed', 'false')
  // feed: 1080×1350
  const dims = async () => {
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.locator('.det-cabeca [data-card]').first().click()])
    const fs = await import('fs')
    const buf = fs.readFileSync(await d.path())
    return { nome: d.suggestedFilename(), w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
  }
  expect(await dims()).toMatchObject({ w: 1080, h: 1350 })
  await fmt.click()
  await expect(page.locator('[data-fmt-card]').first()).toHaveAttribute('aria-pressed', 'true')
  const st = await dims()
  expect(st).toMatchObject({ w: 1080, h: 1920 })
  expect(st.nome).toMatch(/-stories\.png$/)
  // a escolha fica guardada
  await page.reload()
  await expect(page.locator('.det-cabeca [data-fmt-card]').first()).toHaveAttribute('aria-pressed', 'true')
})

test('painel do partido: chapa, municípios, associações, bairros e 2022', async ({ page }) => {
  await page.goto('/#depest')
  await page.locator('#filtros [data-partido]').nth(1).click()
  const pp = page.locator('.cartao.pp')
  await expect(pp).toBeVisible()
  await expect(pp.locator('.cmp-linha').first()).toBeVisible()
  await expect(pp).toContainText('2026 × 2022')
  // a soma por município confere com a soma dos votos de todos os candidatos da chapa
  const n = (t) => Number(t.replace(/\D/g, ''))
  if (await pp.locator('[data-pp-todos]').count()) await pp.locator('[data-pp-todos]').click()
  const chapa = (await pp.locator('.pp-chapa .pp-num strong').allTextContents()).reduce((a, t) => a + n(t), 0)
  expect(n(await pp.locator('.var-resumo strong').first().textContent())).toBe(chapa)
  await pp.locator('[data-pp-grupo="assoc"]').click()
  await expect(pp.locator('.cmp-linha[data-pp-assoc]').first()).toBeVisible()
  const x = await baixar(page, pp.locator('[data-pp-xlsx]'))
  expect(x.nome).toMatch(/painel\.xlsx$/)
  await expect(page).toHaveURL(/[?&]p=/)
  // num município, os bairros (link direto com o partido)
  const partido = new URL(page.url()).hash.match(/[?&]p=([^&]+)/)[1]
  await page.goto('about:blank')
  await page.goto(`/#depest?m=81051&p=${partido}`)
  await page.locator('.cartao.pp [data-pp-grupo="bairro"]').click()
  await expect(page.locator('.cartao.pp [data-pp-grupo="bairro"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.cartao.pp .cmp-linha, .cartao.pp .tabela tr').first()).toBeVisible()
  const img = await baixar(page, page.locator('.cartao.pp [data-card]'))
  expect(img.bytes).toBeGreaterThan(30_000)
})

test('alertas dos acompanhados: avisa quando muda de posição', async ({ page }) => {
  // notificações de mentira: guarda o que seria mostrado
  await page.addInitScript(() => {
    window.__notifs = []
    class N {
      static get permission() {
        return localStorage.getItem('__perm') || 'default'
      }
      static requestPermission() {
        localStorage.setItem('__perm', 'granted')
        return Promise.resolve('granted')
      }
      constructor(t, o) {
        window.__notifs.push(t)
      }
    }
    Object.defineProperty(window, 'Notification', { value: N, configurable: true, writable: true })
    if (window.ServiceWorkerRegistration) ServiceWorkerRegistration.prototype.showNotification = function (t) {
      window.__notifs.push(t)
      return Promise.resolve()
    }
  })
  await page.goto('about:blank') // documento novo, para o script acima valer
  await page.goto('/#depfed')
  await page.locator('[data-fav]').first().click()
  await page.goto('/#favoritos')
  await page.locator('[data-alertas]').click()
  await expect(page.locator('.alertas')).toContainText('Alertas ligados')
  // simula que, na leitura anterior, o candidato estava em 3º
  await page.evaluate(() => {
    const u = JSON.parse(localStorage.getItem('alertas:v1'))
    for (const k in u) u[k].pos = 3
    localStorage.setItem('alertas:v1', JSON.stringify(u))
  })
  await page.reload()
  await expect(page.locator('.aviso-alerta')).toContainText('subiu para 1º (era 3º)')
  await expect.poll(() => page.evaluate(() => window.__notifs.length)).toBeGreaterThan(0)
  // o aviso abre a ficha
  await page.locator('.aviso-alerta').first().click()
  await expect(page.locator('.det-id h2')).toBeVisible()
  // desligar
  await page.goBack()
  await page.locator('[data-alertas]').click()
  await expect(page.locator('[data-alertas]')).toContainText('Ativar alertas')
})

test('modo telão: abre pelo link, passa as telas e sai com Esc', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/#inicio')
  await page.locator('a[href="#telao"]').click()
  const tv = page.locator('.telao')
  await expect(tv).toBeVisible()
  await expect(tv.locator('.tv-topo h2')).toContainText('Governador')
  await expect(tv.locator('.tv-maj li').first()).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(tv.locator('.tv-topo h2')).toContainText('Senado')
  await page.keyboard.press('ArrowRight')
  await expect(tv.locator('.tv-topo h2')).toContainText('Deputado Federal')
  await expect(tv.locator('.tv-lista li')).toHaveCount(16)
  await page.keyboard.press(' ')
  await expect(tv.locator('[data-tv-pausa]')).toHaveText('▶')
  await page.keyboard.press('Escape')
  await expect(tv).toBeHidden()
  await expect(page).not.toHaveURL(/#telao/)
  // abrir direto pelo endereço
  await page.goto('about:blank')
  await page.goto('/#telao')
  await expect(page.locator('.telao .tv-topo h2')).toContainText('Governador')
})
