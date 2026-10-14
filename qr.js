// Leitura do QR code do boletim de urna (apuração paralela no próprio aparelho).
import { corPartido } from './cores.js'
import { icone } from './icones.js'
import { $, VERSAO, esc, fmt, fmtPct, gravarLocal, lerLocal, pctDe } from './nucleo.js'
import { baixarCSV, baixarExcel, botaoCard, carregarScript, totalCard } from './exportar.js'
import { garantirEleicao26 } from './pro.js'
import { ABAS, B26, NOME_MUN, erroSecoes, estado, estiloCor, foto, painel, pill, renderizar, secoesAno } from './app.js'

// Leiaute público do TSE: pares "chave:valor" separados por espaço; o BU pode vir em várias partes (QRBU:i:n).
// Cabeçalho (MUNI, ZONA, SECA, TURN, APTO, COMP…), depois cada cargo: CARG, os votos "número:votos"
// (nos proporcionais agrupados por PART, com LEGP = legenda), BRAN, NULO e TOTC (total do cargo).

export const APUR = (() => {
  try {
    const a = JSON.parse(lerLocal('apuracao:v1', 'null'))
    if (a?.secoes) return { partes: null, cargo: null, msg: '', ...a }
  } catch {}
  return { secoes: {}, partes: null, cargo: null, msg: '' }
})()

export const salvarApur = () => gravarLocal('apuracao:v1', JSON.stringify({ secoes: APUR.secoes }))

export const NOME_CARGO = { 1: 'Presidente', 3: 'Governador', 5: 'Senado', 6: 'Dep. Federal', 7: 'Dep. Estadual', 11: 'Prefeito', 13: 'Vereador' }

export function interpretarBU(texto) {
  const H = {}, cargos = {}
  let cargo = null, partido = null
  for (const t of texto.trim().split(/\s+/)) {
    const i = t.indexOf(':')
    if (i < 1) continue
    const k = t.slice(0, i), v = t.slice(i + 1)
    if (['QRBU', 'VRQR', 'VRCH', 'HASH', 'ASSI'].includes(k)) continue
    if (k === 'IDEL') {
      cargo = null
      continue
    }
    if (k === 'CARG') {
      cargo = cargos[v] ??= { votos: {}, legenda: {}, bran: 0, nulo: 0, tot: 0 }
      partido = null
      continue
    }
    if (!cargo) {
      H[k] = v
      continue
    }
    if (/^\d+$/.test(k)) cargo.votos[Number(k)] = (cargo.votos[Number(k)] || 0) + Number(v)
    else if (k === 'PART') partido = Number(v)
    else if (k === 'LEGP' && partido != null) cargo.legenda[partido] = Number(v)
    else if (k === 'BRAN') cargo.bran = Number(v)
    else if (k === 'NULO') cargo.nulo = Number(v)
    else if (k === 'TOTC') cargo.tot = Number(v)
  }
  if (!H.MUNI || !H.ZONA || !H.SECA || !Object.keys(cargos).length) throw new Error('Não reconheci este QR code como boletim de urna.')
  // conferência interna: votos + legenda + brancos + nulos = total de cada cargo
  const somaOk = Object.values(cargos).every((c) => !c.tot || Object.values(c.votos).reduce((a, v) => a + v, 0) + Object.values(c.legenda).reduce((a, v) => a + v, 0) + c.bran + c.nulo === c.tot)
  return { cd: String(Number(H.MUNI)).padStart(5, '0'), zona: Number(H.ZONA), secao: Number(H.SECA), turno: Number(H.TURN) || 1, aptos: Number(H.APTO) || 0, comp: Number(H.COMP) || 0, cargos, somaOk, lido: Date.now() }
}

// recebe o texto de um QR; junta as partes e grava a seção quando completa
export function receberQR(texto) {
  const m = /QRBU:(\d+):(\d+)/.exec(texto)
  if (!m) return (APUR.msg = '⚠️ Este QR code não é de boletim de urna.'), false
  const [i, n] = [Number(m[1]), Number(m[2])]
  if (!APUR.partes || APUR.partes.n !== n || (i === 1 && APUR.partes.p[1] && APUR.partes.p[1] !== texto)) APUR.partes = { n, p: {} }
  if (APUR.partes.p[i] === texto) return false
  APUR.partes.p[i] = texto
  const faltam = [...Array(n)].map((_, k) => k + 1).filter((k) => !APUR.partes.p[k])
  if (faltam.length) {
    APUR.msg = `📄 Parte ${i} de ${n} lida. Falta ${faltam.length === 1 ? 'a parte' : 'as partes'} ${faltam.join(', ')}.`
    return true
  }
  try {
    const bu = interpretarBU(Object.keys(APUR.partes.p).sort((a, b) => a - b).map((k) => APUR.partes.p[k]).join(' '))
    const k = `${bu.cd}|${bu.zona}-${bu.secao}`
    const ja = !!APUR.secoes[k]
    APUR.secoes[k] = bu
    salvarApur()
    APUR.msg = `${ja ? '🔁 Seção já lida, atualizada' : '✅ Seção lida'}: ${NOME_MUN.get(bu.cd) || bu.cd} · zona ${bu.zona} · seção ${bu.secao}${bu.somaOk ? '' : ' · ⚠️ a soma dos votos não bate com o total impresso'}`
  } catch (e) {
    APUR.msg = `⚠️ ${e.message}`
  }
  APUR.partes = null
  return true
}

// confere a seção lida com o boletim publicado pelo TSE (dados2026/secoes)
export function conferirSecao(bu, re) {
  const arq = secoesAno(2026, bu.cd, re)
  if (!arq) return erroSecoes(2026, bu.cd) ? 'sem' : null
  const zs = `${bu.zona}-${bu.secao}`
  let algum = false
  for (const [c, x] of Object.entries(bu.cargos)) {
    const arr = arq.votos[`t${bu.turno}-c${c}`]?.[zs]
    if (!arr) continue
    algum = true
    const of = new Map()
    for (let i = 0; i < arr.length; i += 2) of.set(arr[i], arr[i + 1])
    const meu = new Map(Object.entries({ ...x.votos, ...x.legenda }).map(([nr, v]) => [Number(nr), v]))
    for (const nr of new Set([...of.keys(), ...meu.keys()])) if (nr < 95 || nr > 97 ? (of.get(nr) || 0) !== (meu.get(nr) || 0) : false) return 'diverge'
  }
  return algum ? 'confere' : 'sem'
}

export function renderApuracaoQR() {
  const re = () => estado.aba.tipo === 'bai' && B26.modo === 'qr' && renderizar()
  const secs = Object.entries(APUR.secoes).sort((a, b) => b[1].lido - a[1].lido)
  const cargos = [...new Set(secs.flatMap(([, s]) => Object.keys(s.cargos)))].map(Number).sort((a, b) => a - b)
  if (!cargos.includes(APUR.cargo)) APUR.cargo = cargos.includes(6) ? 6 : cargos[0] ?? null
  const leitor = `<section class="cartao qr-leitor"><h3>📷 Ler boletim de urna</h3>
      <p class="nota">Leia o QR code impresso no boletim de urna de cada seção (no fim da votação, colado na porta da seção). Os votos somam aqui, neste aparelho, e cada seção é conferida com o boletim publicado pelo TSE. Não há painel central nesta versão.</p>
      <div class="pm-botoes"><button type="button" class="botao" data-qr-camera>📷 Abrir câmera</button>
        <label class="botao secundario qr-foto-bt">🖼️ Ler de uma foto<input id="qr-foto" type="file" accept="image/*" hidden></label></div>
      <details class="qr-colar"><summary>Colar o texto do QR code (ex.: do app "Boletim na Mão")</summary>
        <textarea id="qr-texto" rows="4" placeholder="QRBU:1:1 VRQR:… MUNI:… ZONA:… SECA:…"></textarea>
        <button type="button" class="botao secundario" data-qr-colar>Adicionar</button></details>
      ${APUR.msg ? `<p class="qr-msg" role="status">${esc(APUR.msg)}</p>` : ''}
    </section>`
  if (!secs.length) return leitor
  // totais do cargo escolhido
  const tot = new Map()
  let bran = 0, nulo = 0, aptos = 0, comp = 0
  for (const [, s] of secs) {
    aptos += s.aptos
    comp += s.comp
    const x = s.cargos[APUR.cargo]
    if (!x) continue
    for (const [nr, v] of Object.entries({ ...x.votos, ...x.legenda })) tot.set(Number(nr), (tot.get(Number(nr)) || 0) + v)
    bran += x.bran
    nulo += x.nulo
  }
  const turno = secs[0][1].turno
  const elId = `t${turno}-c${APUR.cargo}`
  const el = B26.els.get(elId)
  if (!el && ABAS.some((a) => a.cargo === APUR.cargo)) garantirEleicao26(elId).then(re).catch(() => {})
  const nome = (nr) => {
    const c = el?.candidatos.find((x) => Number(x.numero) === nr)
    return c ? { nome: c.nome, partido: c.partido } : nr < 100 ? { nome: `Legenda ${el?.partidos?.[String(nr)] || nr}`, partido: el?.partidos?.[String(nr)] || '' } : { nome: `Nº ${nr}`, partido: '' }
  }
  const validos = [...tot.values()].reduce((a, v) => a + v, 0)
  const ranking = [...tot.entries()].sort((a, b) => b[1] - a[1])
  const max = Math.max(1, ...ranking.map(([, v]) => v))
  const confs = secs.map(([k, s]) => [k, s, conferirSecao(s, re)])
  const nDiv = confs.filter((x) => x[2] === 'diverge').length
  APUR.export = {
    csv: { nome: `apuracao-${secs.length}-secoes.csv`, cab: ['Município', 'Zona', 'Seção', 'Cargo', 'Número', 'Nome', 'Votos', 'Conferência'],
      linhas: confs.flatMap(([, s, cf]) => Object.entries(s.cargos).flatMap(([c, x]) => [...Object.entries({ ...x.votos, ...x.legenda }).map(([nr, v]) => [NOME_MUN.get(s.cd) || s.cd, s.zona, s.secao, NOME_CARGO[c] || c, Number(nr), Number(c) === APUR.cargo ? nome(Number(nr)).nome : '', v, cf || '']), [NOME_MUN.get(s.cd) || s.cd, s.zona, s.secao, NOME_CARGO[c] || c, 95, 'Brancos', x.bran, cf || ''], [NOME_MUN.get(s.cd) || s.cd, s.zona, s.secao, NOME_CARGO[c] || c, 96, 'Nulos', x.nulo, cf || '']])) },
    card: { turno, nome: `Apuração paralela · ${NOME_CARGO[APUR.cargo] || ''}`, cor: '#0b7a45', sub: `${secs.length} ${secs.length === 1 ? 'seção lida' : 'seções lidas'} · ${fmt.format(comp)} eleitores votaram`,
      titulo: 'Boletins de urna lidos', subtitulo: nDiv ? `${nDiv} seção(ões) com diferença do TSE` : 'Conferido com os boletins publicados pelo TSE',
      linhas: ranking.slice(0, 8).map(([nr, v]) => { const n = nome(nr); return { nome: n.nome, extra: `${n.partido}${n.partido ? ' · ' : ''}nº ${nr}`, valor: fmt.format(v), dir2: `${fmtPct.format(pctDe(v, validos))}%`, frac: v / max, corBarra: corPartido(n.partido) } }),
      total: totalCard(`Votos válidos · ${NOME_CARGO[APUR.cargo] || ''}`, validos) },
  }
  return leitor + `<section class="cartao"><h3>🧮 Soma dos boletins lidos</h3>
      <p class="nota">${secs.length} ${secs.length === 1 ? 'seção' : 'seções'} · ${fmt.format(comp)} de ${fmt.format(aptos)} eleitores votaram · brancos ${fmt.format(bran)} · nulos ${fmt.format(nulo)}</p>
      <div class="segmentado" role="group" aria-label="Cargo">${cargos.map((c) => `<button type="button" data-qr-cargo="${c}" aria-pressed="${c === APUR.cargo}">${esc(NOME_CARGO[c] || `Cargo ${c}`)}</button>`).join('')}</div>
      <ol class="qr-ranking">${ranking.slice(0, APUR.todos ? 500 : 15).map(([nr, v]) => { const n = nome(nr); const cor = corPartido(n.partido); return `<li style="${estiloCor(cor)}"><div><strong>${esc(n.nome)}</strong> ${n.partido ? pill(n.partido, cor) : ''} <span class="mudo">nº ${nr}</span></div><div class="barra fina"><span style="width:${(100 * v) / max}%;background:${cor}"></span></div><div class="cand-meta">${fmt.format(v)} votos · ${fmtPct.format(pctDe(v, validos))}%</div></li>` }).join('')}</ol>
      ${!APUR.todos && ranking.length > 15 ? `<button type="button" class="botao secundario" data-qr-todos>Mostrar todos (${ranking.length})</button>` : ''}
      <div class="exportar">${botaoCard('apuracao', APUR.export.card)}<button type="button" class="botao secundario" data-qr-csv>${icone('baixar')} Planilha (CSV)</button><button type="button" class="botao secundario" data-qr-xlsx>${icone('baixar')} Excel</button></div>
    </section>
    <section class="cartao"><h3>📋 Seções lidas</h3>
      <ul class="qr-secoes">${confs.map(([k, s, cf]) => `<li><span><strong>${esc(NOME_MUN.get(s.cd) || s.cd)}</strong> · zona ${s.zona} · seção ${s.secao}<br><span class="mudo">${fmt.format(s.comp)} votaram de ${fmt.format(s.aptos)}</span></span>
        <span class="qr-conf ${cf || ''}">${cf === 'confere' ? '✅ confere com o TSE' : cf === 'diverge' ? '⚠️ diferente do TSE' : cf === 'sem' ? 'sem boletim do TSE' : '…'}${s.somaOk ? '' : ' · soma não bate'}</span>
        <button type="button" class="link-zonas leve" data-qr-tirar="${esc(k)}" aria-label="Tirar esta seção">✕</button></li>`).join('')}</ul>
      <button type="button" class="botao secundario" data-qr-limpar>Apagar todas as seções lidas</button>
    </section>`
}

// câmera em tela cheia por cima do app (o app pode redesenhar à vontade por baixo)
export let qrCam = null

export async function abrirCameraQR() {
  if (!navigator.mediaDevices?.getUserMedia) return alert('Este navegador não dá acesso à câmera. Use "Ler de uma foto".')
  const tela = document.createElement('div')
  tela.className = 'qr-camera'
  tela.innerHTML = `<video playsinline muted></video><div class="qr-mira" aria-hidden="true"></div><p class="qr-cam-msg" role="status">Aponte para o QR code do boletim…</p><button type="button" class="botao">Fechar câmera</button>`
  document.body.append(tela)
  const video = tela.querySelector('video'), msg = tela.querySelector('.qr-cam-msg')
  const fechar = () => {
    qrCam?.stream?.getTracks().forEach((t) => t.stop())
    qrCam = null
    tela.remove()
    renderizar()
  }
  tela.querySelector('button').addEventListener('click', fechar)
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
    qrCam = { stream, ultimo: '', fechar }
    video.srcObject = stream
    await video.play()
  } catch {
    msg.textContent = 'Não consegui abrir a câmera (permissão negada?). Use "Ler de uma foto".'
    return
  }
  const detector = 'BarcodeDetector' in window ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null
  if (!detector && !window.jsQR) await carregarScript(`lib/jsqr/jsQR.js?v=${VERSAO}`).catch(() => {})
  const cv = document.createElement('canvas')
  const passo = async () => {
    if (!qrCam) return
    let txt = null
    try {
      if (detector) txt = (await detector.detect(video))[0]?.rawValue || null
      else if (window.jsQR && video.videoWidth) {
        cv.width = video.videoWidth
        cv.height = video.videoHeight
        const g = cv.getContext('2d', { willReadFrequently: true })
        g.drawImage(video, 0, 0)
        txt = window.jsQR(g.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height)?.data || null
      }
    } catch {}
    if (txt && txt !== qrCam.ultimo) {
      qrCam.ultimo = txt
      if (receberQR(txt)) {
        navigator.vibrate?.(80)
        msg.textContent = APUR.msg
        renderizar()
      }
    }
    setTimeout(passo, 250)
  }
  passo()
}

export async function lerFotoQR(input) {
  const f = input.files?.[0]
  if (!f) return
  try {
    const bmp = await createImageBitmap(f)
    let txt = null
    if ('BarcodeDetector' in window) txt = (await new window.BarcodeDetector({ formats: ['qr_code'] }).detect(bmp))[0]?.rawValue || null
    if (!txt) {
      if (!window.jsQR) await carregarScript(`lib/jsqr/jsQR.js?v=${VERSAO}`)
      const esc2 = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
      const cv = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * esc2), height: Math.round(bmp.height * esc2) })
      const g = cv.getContext('2d')
      g.drawImage(bmp, 0, 0, cv.width, cv.height)
      txt = window.jsQR(g.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height)?.data || null
    }
    if (!txt) APUR.msg = '⚠️ Não achei um QR code nesta foto. Tente uma foto mais de perto e nítida.'
    else receberQR(txt)
  } catch {
    APUR.msg = '⚠️ Não consegui abrir a foto.'
  }
  input.value = ''
  renderizar()
}

export function tratarQR(h) {
  let x
  if (h('[data-qr-camera]')) return (abrirCameraQR(), true)
  if (h('[data-qr-colar]')) {
    const t = document.getElementById('qr-texto')?.value || ''
    const partes = t.split(/(?=QRBU:\d+:\d+)/).map((p) => p.trim()).filter(Boolean)
    if (!partes.length) APUR.msg = '⚠️ Cole o texto do QR code (começa com QRBU:).'
    partes.forEach(receberQR)
    return (renderizar(), true)
  }
  if ((x = h('[data-qr-cargo]'))) return ((APUR.cargo = Number(x.dataset.qrCargo)), renderizar(), true)
  if (h('[data-qr-todos]')) return ((APUR.todos = true), renderizar(), true)
  if ((x = h('[data-qr-tirar]'))) return (delete APUR.secoes[x.dataset.qrTirar], salvarApur(), renderizar(), true)
  if (h('[data-qr-limpar]')) {
    if (!confirm('Apagar todas as seções lidas deste aparelho?')) return true
    return ((APUR.secoes = {}), (APUR.msg = ''), salvarApur(), renderizar(), true)
  }
  if (h('[data-qr-csv]') && APUR.export) return (baixarCSV(APUR.export.csv), true)
  if ((x = h('[data-qr-xlsx]')) && APUR.export) return (baixarExcel(APUR.export.csv.nome.replace(/\.csv$/, '.xlsx'), [{ aba: 'Boletins lidos', ...APUR.export.csv }], x), true)
  return false
}
