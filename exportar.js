// Exportação: imagens para compartilhar (cards e carrosséis), PDF, Excel, CSV e as listas comparadas que eles usam.
import { icone } from './icones.js'
import { $, BASE, COR_VAR, VERSAO, esc, fmt, fmtPct, gravarLocal, lerLocal, nomeArquivo, num } from './nucleo.js'
import { foto, resumo } from './app.js'

export function carregarScript(src) {
  return new Promise((ok, falha) => {
    const el = Object.assign(document.createElement('script'), { src, onload: ok, onerror: falha })
    document.head.append(el)
  })
}

// monta um PDF com uma página A4 por card (capa + seções), com cabeçalho e rodapé
export async function gerarPDF(cards, titulo, botao) {
  const rotulo = botao?.innerHTML
  try {
    if (botao) (botao.disabled = true), (botao.innerHTML = '⏳ Preparando o PDF…')
    if (!window.jspdf) await carregarScript(`lib/jspdf/jspdf.umd.min.js?v=${VERSAO}`)
    const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true })
    const quando = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    pdf.setProperties({ title: `${titulo} · Apuração 2026 SC`, author: 'Maicon Combat (@maiconcombat)', creator: 'Apuração 2026 SC' })
    for (const [i, card] of cards.entries()) {
      if (botao) botao.innerHTML = `⏳ Página ${i + 1} de ${cards.length}…`
      const { blob } = await desenharCard({ ...card, pagina: null })
      const bmp = await createImageBitmap(blob)
      const cv = Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height })
      cv.getContext('2d').drawImage(bmp, 0, 0)
      if (i) pdf.addPage()
      pdf.setFont('helvetica', 'bold').setFontSize(10).setTextColor(23, 32, 27)
      pdf.text(`${titulo} · Apuração 2026 SC`.slice(0, 95), 15, 14)
      pdf.setDrawColor(0, 156, 59).setLineWidth(0.6).line(15, 17, 195, 17)
      pdf.addImage(cv.toDataURL('image/jpeg', 0.9), 'JPEG', 24, 24, 162, 202.5)
      pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(95, 107, 101)
      pdf.text(`Fonte: TSE (divulgação de resultados e boletins de urna) · gerado em ${quando}`, 15, 284)
      pdf.text(`maiconcombat.com.br · @maiconcombat · página ${i + 1} de ${cards.length}`, 195, 289, { align: 'right' })
    }
    const nome = `relatorio-${nomeArquivo(titulo)}.pdf`
    const arq = new File([pdf.output('blob')], nome, { type: 'application/pdf' })
    if (navigator.canShare?.({ files: [arq] })) {
      try {
        return await navigator.share({ files: [arq], title: titulo })
      } catch (e) {
        if (e?.name === 'AbortError') return
      }
    }
    baixarArquivo(nome, arq)
  } catch (e) {
    alert('Não consegui gerar o PDF agora. Tente de novo em instantes.')
  } finally {
    if (botao) (botao.disabled = false), (botao.innerHTML = rotulo)
  }
}

export async function baixarExcel(nome, abas, botao) {
  const rotulo = botao?.innerHTML
  try {
    if (botao) (botao.disabled = true), (botao.innerHTML = '⏳ Gerando o Excel…')
    if (!window.XLSX) await carregarScript(`lib/xlsx/xlsx.mini.min.js?v=${VERSAO}`)
    const X = window.XLSX
    const wb = X.utils.book_new()
    const usados = new Set()
    for (const a of abas) {
      const linhas = a.linhas.map((l) => l.map((v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v)))
      const ws = X.utils.aoa_to_sheet([a.cab, ...linhas])
      ws['!cols'] = a.cab.map((c, i) => ({ wch: Math.min(50, Math.max(String(c).length, ...linhas.slice(0, 300).map((l) => String(l[i] ?? '').length)) + 2) }))
      ws['!autofilter'] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: linhas.length, c: a.cab.length - 1 } }) }
      let n = String(a.aba).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)
      while (usados.has(n)) n = `${n.slice(0, 28)} ${usados.size}`
      usados.add(n)
      X.utils.book_append_sheet(wb, ws, n)
    }
    wb.Props = { Title: nome, Author: 'Apuração 2026 SC · @maiconcombat' }
    const buf = X.write(wb, { bookType: 'xlsx', type: 'array', compression: true })
    baixarArquivo(nome, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  } catch {
    alert('Não consegui gerar a planilha agora. Tente de novo em instantes.')
  } finally {
    if (botao) (botao.disabled = false), (botao.innerHTML = rotulo)
  }
}

export function baixarArquivo(nome, blob) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = nome
  document.body.append(a)
  a.click()
  setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1500)
}

// CSV no padrão do Excel em português: separador ";", vírgula decimal e BOM UTF-8
export function baixarCSV({ nome, cab, linhas }) {
  const q = (v) => (typeof v === 'number' ? String(Math.round(v * 100) / 100).replace('.', ',') : `"${String(v ?? '').replace(/"/g, '""')}"`)
  const txt = '﻿' + [cab, ...linhas].map((l) => l.map(q).join(';')).join('\r\n')
  baixarArquivo(nome, new Blob([txt], { type: 'text/csv;charset=utf-8' }))
}

// Imagem para compartilhar (1080×1350, formato retrato do Instagram). Um card tem:
//   chapeu, nome, sub, cor            → faixa do topo
//   titulo, subtitulo                 → título do conteúdo
//   tiles:  [{ rot, valor, sub, cor }]                       → blocos de números (2 por linha)
//   linhas: [{ nome, extra, valor, dir2, corDir2, frac, ponto, barras: [{ frac, cor }] }] → lista
//   pilhas: [{ nome, extra, segs: [{ frac, cor, txt }] }] + legenda: [{ cor, txt }]     → barras empilhadas
//   rodape, fonte, exclusivo          → rodapé (com a foto e o @ do criador)
export const CARDS = new Map()

// registra o card e devolve o botão que o compartilha (a chave identifica o lugar da tela)
export function botaoCard(chave, card, rotulo = `${icone('compartilhar')} Compartilhar imagem`, classe = 'botao') {
  CARDS.set(chave, card)
  return `<span class="card-grupo"><button type="button" class="${classe} botao-card" data-card="${esc(chave)}">${rotulo}</button><button type="button" class="fmt-card" data-fmt-card aria-pressed="${formatoCard() === 'story'}" title="Formato da imagem: Stories 9:16 (ligado) ou feed 4:5 (desligado)">Stories</button></span>`
}

// formato das imagens: 'feed' (1080×1350, 4:5) ou 'story' (1080×1920, 9:16); vale para todos os cards e carrosséis
export const formatoCard = () => (lerLocal('formatoCard', 'feed') === 'story' ? 'story' : 'feed')

document.addEventListener('click', (ev) => {
  if (!ev.target.closest('[data-fmt-card]')) return
  const story = formatoCard() !== 'story'
  gravarLocal('formatoCard', story ? 'story' : 'feed')
  for (const b of document.querySelectorAll('[data-fmt-card]')) b.setAttribute('aria-pressed', String(story))
})

document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-card]')
  if (!b || !CARDS.has(b.dataset.card)) return
  ev.stopPropagation()
  compartilharCard(CARDS.get(b.dataset.card))
}, true)

// baixa uma imagem com CORS (a foto do TSE libera o domínio do app) para poder desenhar no canvas
export function carregarImagem(url) {
  if (!url) return Promise.resolve(null)
  return fetch(url, { mode: 'cors' })
    .then((r) => (r.ok ? r.blob() : null))
    .then((b) => b && new Promise((ok) => {
      const im = new Image()
      im.onload = () => ok(im)
      im.onerror = () => ok(null)
      im.src = URL.createObjectURL(b)
    }))
    .catch(() => null)
}

// desenha uma imagem recortada em círculo, com aro
export function fotoCirculo(g, im, cx, cy, r, aro = '#ffffff', larg = 6) {
  g.save()
  g.beginPath()
  g.arc(cx, cy, r + larg, 0, 2 * Math.PI)
  g.fillStyle = aro
  g.fill()
  g.beginPath()
  g.arc(cx, cy, r, 0, 2 * Math.PI)
  g.clip()
  const lado = Math.min(im.naturalWidth, im.naturalHeight)
  // fotos de candidato são retratos: corta mais perto do topo
  const y0 = im.naturalHeight > im.naturalWidth ? (im.naturalHeight - lado) * 0.2 : (im.naturalHeight - lado) / 2
  g.drawImage(im, (im.naturalWidth - lado) / 2, y0, lado, lado, cx - r, cy - r, 2 * r, 2 * r)
  g.restore()
}

// legenda que acompanha as imagens (e que o botão "copiar legenda" copia)
export const INSTAGRAM = 'https://www.instagram.com/maiconcombat/'

export const legendaShare = (titulo) => `${titulo}\n\n📲 Siga @maiconcombat 👉 ${INSTAGRAM}\nApuração 2026 · dados oficiais do TSE`

export async function compartilharCard(card) {
  const { blob, nome } = await desenharCard(card, formatoCard())
  const arq = new File([blob], nome, { type: 'image/png' })
  if (navigator.canShare?.({ files: [arq] })) {
    try {
      await navigator.share({ files: [arq], title: `${card.nome} · ${card.titulo}`, text: legendaShare(`${card.nome} · ${card.titulo}`) })
      return
    } catch (e) {
      if (e?.name === 'AbortError') return
    }
  }
  baixarArquivo(nome, blob)
}

// Carrossel: várias imagens compartilhadas de uma vez (Instagram aceita até 20); sem suporte, baixa uma a uma
export async function compartilharCarrossel(cards, titulo, botao) {
  const total = cards.length
  const rotulo = botao?.innerHTML
  const arqs = []
  for (const [i, card] of cards.entries()) {
    if (botao) botao.innerHTML = `⏳ Gerando ${i + 1} de ${total}…`
    const { blob, nome } = await desenharCard({ ...card, pagina: `${i + 1}/${total}` }, formatoCard())
    arqs.push(new File([blob], `${String(i + 1).padStart(2, '0')}-${nome}`, { type: 'image/png' }))
  }
  if (botao) botao.innerHTML = rotulo
  if (navigator.canShare?.({ files: arqs })) {
    try {
      await navigator.share({ files: arqs, title: titulo, text: legendaShare(titulo) })
      return
    } catch (e) {
      if (e?.name === 'AbortError') return
    }
  }
  for (const a of arqs) {
    baixarArquivo(a.name, a)
    await new Promise((ok) => setTimeout(ok, 350))
  }
}

export async function desenharCard(card, formato = 'feed') {
  // Stories (9:16): a mesma arte num quadro mais alto, com margens livres em cima e embaixo para a
  // interface do Instagram (nome, respostas); o conteúdo ganha espaço para mais linhas
  const story = formato === 'story'
  const W = 1080, ALTO = story ? 1920 : 1350, TOPO = story ? 200 : 0, BASE = story ? 170 : 0
  const H = ALTO - TOPO - BASE
  const fotosTopo = (await Promise.all((card.fotos || (card.foto ? [card.foto] : [])).slice(0, 2).map(carregarImagem))).filter(Boolean)
  const fotosLinha = await Promise.all((card.linhas || []).slice(0, 14).map((l) => carregarImagem(l.foto)))
  // a fonte do app precisa estar carregada antes de desenhar no canvas
  await Promise.all([500, 600, 700, 800].map((p) => document.fonts?.load(`${p} 20px Inter`).catch(() => null)))
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = ALTO
  const g = cv.getContext('2d')
  if (story) {
    const gt = g.createLinearGradient(0, 0, W, 300)
    gt.addColorStop(0, '#006b2d')
    gt.addColorStop(0.5, '#009c3b')
    gt.addColorStop(1, '#0a5ea8')
    g.fillStyle = gt
    g.fillRect(0, 0, W, TOPO)
    const gb = g.createLinearGradient(0, ALTO - BASE, W, ALTO)
    gb.addColorStop(0, '#0b3d1f')
    gb.addColorStop(1, '#0a4a8a')
    g.fillStyle = gb
    g.fillRect(0, ALTO - BASE, W, BASE)
    g.translate(0, TOPO)
  }
  const fonte = (peso, tam) => `${peso} ${tam}px Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
  const corta = (txt, max) => {
    let t = String(txt ?? '')
    if (g.measureText(t).width <= max) return t
    while (t.length > 1 && g.measureText(t + '…').width > max) t = t.slice(0, -1)
    return t + '…'
  }
  const caixa = (x, y, w, h, r = 18, cor = '#ffffff') => {
    g.fillStyle = cor
    g.beginPath()
    g.roundRect(x, y, w, h, r)
    g.fill()
  }
  const cor = card.cor || '#0b7a45'
  // topo
  g.fillStyle = '#f4f7f5'
  g.fillRect(0, 0, W, H)
  const grad = g.createLinearGradient(0, 0, W, 300)
  grad.addColorStop(0, '#006b2d')
  grad.addColorStop(0.5, '#009c3b')
  grad.addColorStop(1, '#0a5ea8')
  g.fillStyle = grad
  g.fillRect(0, 0, W, 300)
  g.fillStyle = '#ffdf00'
  g.fillRect(0, 300, W, 10)
  g.fillStyle = 'rgba(255,255,255,.85)'
  g.font = fonte(600, 30)
  g.fillText(corta(card.chapeu || 'APURAÇÃO 2026 · SANTA CATARINA', card.exclusivo ? W - 420 : W - 128 - ((card.fotos || card.foto) ? 220 : 0)), 64, 76)
  if (card.exclusivo) {
    g.font = fonte(800, 24)
    const t = 'ANÁLISE EXCLUSIVA'
    const w = g.measureText(t).width + 36
    caixa(W - 64 - w, 26, w, 40, 20, '#ffdf00')
    g.fillStyle = '#0b3d1f'
    g.fillText(t, W - 64 - w + 18, 54)
  }
  const reservaFoto = fotosTopo.length ? (fotosTopo.length > 1 ? 330 : 210) : 0
  g.fillStyle = '#fff'
  g.font = fonte(800, fotosTopo.length > 1 ? 40 : card.nome && card.nome.length > 22 ? 54 : 66)
  g.fillText(corta(card.nome, W - 128 - reservaFoto), 64, 160)
  g.font = fonte(500, 34)
  g.fillText(corta(card.sub, W - 128 - reservaFoto), 64, 222)
  fotosTopo.forEach((im, i) => fotoCirculo(g, im, W - 64 - 88 - i * 150, 176, 88, i ? '#ffdf00' : '#ffffff', 6))
  g.fillStyle = cor
  g.fillRect(64, 256, 120, 12)
  // título
  g.fillStyle = '#17201b'
  g.font = fonte(800, 44)
  g.fillText(corta(card.titulo, W - 128 - (card.pagina ? 150 : 0)), 64, 384)
  if (card.pagina) {
    g.font = fonte(800, 26)
    const t = card.pagina
    const w = g.measureText(t).width + 32
    caixa(W - 64 - w, 350, w, 44, 22, '#17201b')
    g.fillStyle = '#ffffff'
    g.fillText(t, W - 64 - w + 16, 381)
  }
  g.fillStyle = '#5f6b65'
  g.font = fonte(500, 30)
  g.fillText(corta(card.subtitulo, W - 128), 64, 430)
  let y = 456
  const FAIXA = 190
  const LIM = H - FAIXA - (card.rodape ? 76 : 44) - (card.total ? 92 : 0)
  // blocos de números
  const tiles = (card.tiles || []).slice(0, 6)
  if (tiles.length) {
    const tw = (W - 96 - 16) / 2, th = 122
    tiles.forEach((t, i) => {
      const x = 48 + (i % 2) * (tw + 16), yy = y + Math.floor(i / 2) * (th + 12)
      caixa(x, yy, tw, th)
      g.fillStyle = t.cor || cor
      g.fillRect(x, yy + 22, 8, th - 44)
      g.fillStyle = '#5f6b65'
      g.font = fonte(600, 26)
      g.fillText(corta(t.rot, tw - 60), x + 32, yy + 40)
      g.fillStyle = '#17201b'
      g.font = fonte(800, 46)
      g.fillText(corta(t.valor, tw - 60), x + 32, yy + 88)
      if (t.sub) {
        g.fillStyle = t.corSub || '#5f6b65'
        g.font = fonte(600, 21)
        g.fillText(corta(t.sub, tw - 60), x + 32, yy + 112)
      }
    })
    y += Math.ceil(tiles.length / 2) * (th + 12) + 2
  }
  // texto corrido (análise): parágrafos com quebra de linha
  if (card.texto?.length) {
    g.textAlign = 'left'
    for (const par of card.texto) {
      g.font = fonte(500, 27)
      const palavras = String(par).split(' ')
      let linha = '', linhas = []
      for (const w of palavras) {
        const t = linha ? `${linha} ${w}` : w
        if (g.measureText(t).width > W - 150 && linha) (linhas.push(linha), (linha = w))
        else linha = t
      }
      if (linha) linhas.push(linha)
      if (y + linhas.length * 36 + 14 > LIM) break
      g.fillStyle = cor
      g.beginPath()
      g.arc(62, y + 16, 6, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#17201b'
      linhas.forEach((l, k) => g.fillText(l, 80, y + 26 + k * 36))
      y += linhas.length * 36 + 16
    }
  }
  // lista
  for (const [i, l] of (card.linhas || []).entries()) {
    if (l.par) {
      // bairro com 2022 e 2026 alinhados: nome + variação, e duas barras rotuladas (ou uma por candidato)
      const h = 44 + 24 * (l.par.barras?.length || 2)
      if (y + h > LIM) break
      caixa(48, y, W - 96, h)
      const x0 = 72
      g.textAlign = 'right'
      g.font = fonte(800, 24)
      g.fillStyle = l.corDir2 || '#5f6b65'
      const wv = l.dir2 ? g.measureText(l.dir2).width : 0
      if (l.dir2) g.fillText(l.dir2, W - 72, y + 30)
      g.textAlign = 'left'
      g.fillStyle = '#17201b'
      g.font = fonte(800, 28)
      const nm = corta(l.nome, W - x0 - 72 - wv - 24)
      g.fillText(nm, x0, y + 30)
      if (l.extra) {
        const wn = g.measureText(nm).width
        g.fillStyle = '#5f6b65'
        g.font = fonte(500, 20)
        const resto = W - x0 - 72 - wv - 40 - wn
        if (resto > 80) g.fillText(corta(l.extra, resto), x0 + wn + 14, y + 30)
      }
      const mx = l.par.max || 1
      // duas barras: 2022 × 2026 do mesmo candidato, ou dois candidatos (rotA/rotB) na comparação
      const duo = !!(l.par.rotA || l.par.barras)
      const barrasPar = l.par.barras
        ? l.par.barras.map((x, i) => [x.rot, x.v, x.cor, 56 + 24 * i, true])
        : duo
          ? [[l.par.rotA, l.par.a, l.par.corA, 56, true], [l.par.rotB, l.par.b, l.par.corB, 80, true]]
          : [['2022', l.par.v22, '#a5aca8', 56, false], ['2026', l.par.v26, l.corBarra || cor, 80, true]]
      barrasPar.forEach(([rot, v, c, dy, forte]) => {
        g.fillStyle = forte ? '#17201b' : '#5f6b65'
        g.font = fonte(forte ? 800 : 600, duo ? 18 : 20)
        g.fillText(duo ? corta(rot, 176) : rot, x0, y + dy)
        const bx = x0 + (duo ? 186 : 70), bw = W - 72 - 120 - bx
        caixa(bx, y + dy - 14, bw, 14, 7, '#eef2f0')
        if (v > 0) caixa(bx, y + dy - 14, Math.max(8, (bw * v) / mx), 14, 7, c)
        g.textAlign = 'right'
        g.fillStyle = '#17201b'
        g.font = fonte(forte ? 800 : 500, forte ? 26 : 22)
        g.fillText(fmt.format(v), W - 72, y + dy + 2)
        g.textAlign = 'left'
      })
      y += h + 8
      continue
    }
    const temBarras = l.barras?.length
    const h = temBarras ? 92 : 74
    if (y + h > LIM) break
    caixa(48, y, W - 96, h)
    let xn = 72
    const fl = fotosLinha[i]
    if (l.ponto) {
      g.fillStyle = l.ponto
      g.beginPath()
      g.arc(86, y + 28, 13, 0, 2 * Math.PI)
      g.fill()
      xn = 116
    } else if (card.numerar !== false) {
      g.fillStyle = '#5f6b65'
      g.font = fonte(800, 30)
      g.fillText(`${i + 1}º`, 72, y + 36)
      xn = 132
    }
    if (fl) {
      fotoCirculo(g, fl, xn + 25, y + h / 2 - 2, 25, l.corBarra || cor, 3)
      xn += 64
    }
    g.fillStyle = '#17201b'
    g.font = fonte(700, 32)
    g.fillText(corta(l.nome, W - xn - 72 - 370), xn, y + 33)
    g.fillStyle = '#5f6b65'
    g.font = fonte(500, 24)
    g.fillText(corta(l.extra || '', W - xn - 72 - 370), xn, y + 60)
    g.textAlign = 'right'
    g.fillStyle = '#17201b'
    g.font = fonte(800, 36)
    g.fillText(corta(l.valor ?? '', 360), W - 72, y + 36)
    if (l.dir2) {
      g.font = fonte(600, 24)
      g.fillStyle = l.corDir2 || '#5f6b65'
      g.fillText(corta(l.dir2, 360), W - 72, y + 60)
    }
    g.textAlign = 'left'
    if (temBarras) {
      l.barras.forEach((b, k) => {
        g.fillStyle = '#e7ece9'
        g.fillRect(xn, y + 70 + k * 10, W - xn - 72, 6)
        g.fillStyle = b.cor
        g.fillRect(xn, y + 70 + k * 10, (W - xn - 72) * Math.max(0, Math.min(1, b.frac)), 6)
      })
    } else if (l.frac != null) {
      g.fillStyle = l.corBarra || cor
      g.globalAlpha = 0.9
      g.fillRect(xn, y + 66, (W - xn - 72) * Math.max(0, Math.min(1, l.frac)), 4)
      g.globalAlpha = 1
    }
    y += h + 8
  }
  // barras empilhadas
  if (card.legenda?.length) {
    g.font = fonte(600, 24)
    let x = 64
    for (const lg of card.legenda) {
      const w = g.measureText(lg.txt).width + 36
      if (x + w > W - 64) break
      g.fillStyle = lg.cor
      g.beginPath()
      g.arc(x + 10, y + 16, 10, 0, 2 * Math.PI)
      g.fill()
      g.fillStyle = '#17201b'
      g.fillText(lg.txt, x + 26, y + 25)
      x += w + 10
    }
    y += 46
  }
  for (const p of card.pilhas || []) {
    if (y + 64 > LIM) break
    caixa(48, y, W - 96, 64)
    g.fillStyle = '#17201b'
    g.font = fonte(700, 28)
    g.fillText(corta(p.nome, 600), 72, y + 28)
    g.fillStyle = '#5f6b65'
    g.font = fonte(500, 22)
    g.textAlign = 'right'
    g.fillText(corta(p.extra || '', 340), W - 72, y + 28)
    g.textAlign = 'left'
    let x = 72
    const larg = W - 144
    for (const s of p.segs) {
      const w = larg * s.frac
      if (w < 1) continue
      g.fillStyle = s.cor
      g.fillRect(x, y + 37, Math.max(1, w - 2), 20)
      if (w > 70 && s.txt) {
        g.fillStyle = '#fff'
        g.font = fonte(800, 20)
        g.textAlign = 'center'
        g.fillText(s.txt, x + w / 2, y + 53)
        g.textAlign = 'left'
      }
      x += w
    }
    y += 70
  }
  // total do que a imagem representa, logo depois da lista
  if (card.total) {
    const t = card.total
    const ty = Math.min(y + 4, LIM + 8)
    caixa(48, ty, W - 96, 80, 18, '#17201b')
    g.fillStyle = '#ffdf00'
    g.font = fonte(800, 22)
    // o rótulo da esquerda cede espaço ao número da direita
    g.font = fonte(800, 40)
    const livre = Math.min(540, W - 144 - g.measureText(t.valor).width - 36)
    g.font = fonte(800, 22)
    g.fillText(corta(t.quem ? `TOTAL DE ${t.quem.toUpperCase()}` : 'TOTAL', livre), 72, ty + 32)
    g.fillStyle = '#ffffff'
    g.font = fonte(600, 24)
    g.fillText(corta(t.rot, Math.min(450, livre)), 72, ty + 62)
    g.textAlign = 'right'
    g.font = fonte(800, 40)
    g.fillText(corta(t.valor, 440), W - 72, ty + 42)
    if (t.sub) {
      g.font = fonte(700, 20)
      g.fillStyle = t.corSub || '#cfd8d3'
      g.fillText(corta(t.sub, 470), W - 72, ty + 68)
    }
    g.textAlign = 'left'
  }
  // fonte e resumo, acima da faixa do criador
  g.textAlign = 'right'
  g.fillStyle = '#5f6b65'
  g.font = fonte(500, 22)
  g.fillText(corta(card.fonte || `Fonte: TSE · ${card.turno ? `boletins de urna · ${card.turno}º turno` : 'divulgação de resultados'}`, W - 128), W - 64, H - FAIXA - 18)
  g.textAlign = 'left'
  if (card.rodape) {
    g.fillStyle = '#17201b'
    g.font = fonte(600, 26)
    g.fillText(corta(card.rodape, W - 128), 64, H - FAIXA - 52)
  }
  // faixa do criador: foto grande, @ e Instagram
  const gf = g.createLinearGradient(0, H - FAIXA, W, H)
  gf.addColorStop(0, '#0b3d1f')
  gf.addColorStop(1, '#0a4a8a')
  g.fillStyle = gf
  g.fillRect(0, H - FAIXA, W, FAIXA)
  g.fillStyle = '#ffdf00'
  g.fillRect(0, H - FAIXA, W, 6)
  const foto = await new Promise((ok) => {
    const im = new Image()
    im.onload = () => ok(im)
    im.onerror = () => ok(null)
    im.src = `img/maicon-combat.jpg?v=${VERSAO}`
  })
  const cyF = H - FAIXA / 2 + 3
  let xT = 64
  if (foto) {
    fotoCirculo(g, foto, 64 + 62, cyF, 62, '#ffdf00', 7)
    xT = 64 + 124 + 30
  }
  g.fillStyle = '#ffffff'
  g.font = fonte(800, 52)
  g.fillText('@maiconcombat', xT, cyF - 6)
  // ícone do Instagram (contorno) + endereço
  const ix = xT, iy = cyF + 18, il = 34
  g.strokeStyle = '#ffdf00'
  g.lineWidth = 4
  g.beginPath()
  g.roundRect(ix, iy, il, il, 10)
  g.stroke()
  g.beginPath()
  g.arc(ix + il / 2, iy + il / 2, 8, 0, 2 * Math.PI)
  g.stroke()
  g.fillStyle = '#ffdf00'
  g.beginPath()
  g.arc(ix + il - 8, iy + 8, 2.6, 0, 2 * Math.PI)
  g.fill()
  g.font = fonte(700, 30)
  g.fillText('instagram.com/maiconcombat', ix + il + 14, iy + 28)
  g.textAlign = 'right'
  g.fillStyle = 'rgba(255,255,255,.75)'
  g.font = fonte(600, 22)
  g.fillText('maiconcombat.com.br', W - 64, cyF - 12)
  g.textAlign = 'left'
  const blob = await new Promise((ok) => cv.toBlob(ok, 'image/png'))
  return { blob, nome: `${nomeArquivo(card.nome || 'apuracao')}-${nomeArquivo(card.titulo || 'card')}${story ? '-stories' : ''}.png` }
}

// faixa de total do card: votos do lugar e, se houver, 2022 com a variação
export function totalCard(rot, v, v22 = null, sufixo = 'votos', anoRef = 2022) {
  const va = v22 != null ? variacao(v, v22) : null
  const variacaoClara = { 'var-alta-forte': '#7fe0ab', 'var-alta': '#8cbcff', 'var-novo': '#8cbcff', 'var-queda': '#ffbe6b', 'var-queda-forte': '#ff9b91' }
  return { rot, valor: `${fmt.format(v)} ${sufixo}`, sub: v22 != null ? `${anoRef}: ${fmt.format(v22)}${va ? ` · ${va.txt}` : ''}` : '', corSub: va ? variacaoClara[va.cls] || null : null }
}

// linhas de bairros no formato da lista do card
export const linhasBairroCard = (itens) => {
  const max = Math.max(1, ...itens.map((i) => Math.max(i.v, i.v22 ?? 0)))
  return itens.map((i) =>
    i.v22 != null && i.va !== null
      ? { nome: i.nome, extra: i.extra, par: { v22: i.v22, v26: i.v, max }, dir2: i.va?.txt || '', corDir2: i.va ? COR_VAR[i.va.cls] : null }
      : { nome: i.nome, extra: i.extra, valor: fmt.format(i.v), dir2: i.va ? i.va.txt : `${fmtPct.format(i.pct)}% do bairro`, corDir2: i.va ? COR_VAR[i.va.cls] : null, frac: i.v / max },
  )
}

// variação 2022 → 2026 num bairro: verde (alta forte), azul (alta), laranja (queda), vermelho (queda forte)
export function variacao(v26, v22) {
  if (v22 == null) return null
  const dif = v26 - v22
  if (!v22) return v26 ? { cls: 'var-novo', txt: '▲ novo', dif } : null
  const r = dif / v22
  const pctTxt = `${r > 0 ? '+' : r < 0 ? '−' : ''}${fmtPct.format(Math.abs(100 * r))}%`
  const cls = !v26 || r <= -0.2 ? 'var-queda-forte' : r < 0 ? 'var-queda' : r >= 0.2 ? 'var-alta-forte' : r > 0 ? 'var-alta' : 'var-igual'
  // com poucos votos em 2022 o % engana (2 → 242 = +12.000%): mostra só a diferença
  return { cls, txt: `${dif > 0 ? '▲' : dif < 0 ? '▼' : '＝'} ${dif > 0 ? '+' : dif < 0 ? '−' : ''}${fmt.format(Math.abs(dif))}${v22 >= 20 ? ` (${pctTxt})` : ' votos'}`, dif }
}

// lista 2022 × 2026: cada bairro com duas linhas alinhadas (ano · barra · votos) e a variação no canto
// itens: { nome, sub, v, v22, meta, ir: 'data-…="…"' }
export function listaComparada(itens, cor, [a0, a1] = [2022, 2026]) {
  const max = Math.max(1, ...itens.map((i) => Math.max(i.v, i.v22 || 0)))
  const barra = (v) => `${Math.max(v ? 1.5 : 0, (100 * v) / max)}%`
  return `<div class="cmp-lista" role="list">${itens
    .map((i) => {
      const va = variacao(i.v, i.v22 || 0)
      return `<div class="cmp-linha ${i.ir ? 'clicavel' : ''}" role="listitem" ${i.ir || ''}>
        <div class="cmp-topo"><div class="cmp-nome"><strong>${esc(i.nome)}</strong>${i.sub ? ` <span class="mudo">· ${esc(i.sub)}</span>` : ''}</div>${va ? `<span class="var ${va.cls}">${va.txt}</span>` : ''}</div>
        <div class="cmp-ano"><span class="cmp-rot">${a0}</span><span class="cmp-trilho"><span class="vb22" style="width:${barra(i.v22 || 0)}"></span></span><span class="cmp-num">${fmt.format(i.v22 || 0)}</span></div>
        <div class="cmp-ano agora"><span class="cmp-rot">${a1}</span><span class="cmp-trilho"><span class="vb26" style="width:${barra(i.v)};background:${cor}"></span></span><span class="cmp-num"><strong>${fmt.format(i.v)}</strong></span></div>
        ${i.meta ? `<div class="cand-meta">${i.meta}</div>` : ''}
        ${i.extra || ''}
      </div>`
    })
    .join('')}</div>`
}

export const legendaVar = (cor) => `<div class="var-legenda"><span class="var var-alta-forte">▲ +20% ou mais</span><span class="var var-alta">▲ subiu</span><span class="var var-queda">▼ caiu</span><span class="var var-queda-forte">▼ −20% ou mais</span></div>`
