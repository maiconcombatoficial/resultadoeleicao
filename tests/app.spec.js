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
