// Cores de identidade dos partidos (aproximadas das marcas oficiais).
// A chave é a sigla em maiúsculas, sem acentos nem espaços ("PC do B" → "PCDOB").
const CORES = {
  PT: '#d7161e',
  PCDOB: '#a3161a',
  PV: '#1f9d3a',
  PSOL: '#f4c300',
  REDE: '#00a99d',
  PSB: '#f7941d',
  PDT: '#e2421f',
  MDB: '#179443',
  PSD: '#f0a30a',
  PP: '#3da5dd',
  UNIAO: '#1b4fa0',
  PL: '#0e2e6e',
  REPUBLICANOS: '#2774c2',
  PSDB: '#0b5aa6',
  NOVO: '#f26822',
  PODE: '#00a859',
  CIDADANIA: '#e6007e',
  AVANTE: '#34b3e4',
  SOLIDARIEDADE: '#f68b1f',
  PRD: '#003da5',
  AGIR: '#ff6a13',
  DC: '#00703c',
  MOBILIZA: '#6d2c91',
  PMB: '#d6337a',
  PCO: '#b00000',
  PSTU: '#c8102e',
  UP: '#b71c1c',
  PCB: '#8b0000',
  MISSAO: '#ffb000',
  // partidos fictícios do modo demonstração
  PAA: '#d7161e',
  PBB: '#1b4fa0',
  PCC: '#179443',
  PDD: '#f0a30a',
  PEE: '#e6007e',
  PFF: '#00a99d',
  PGG: '#6d2c91',
  PHH: '#f26822',
  PII: '#3da5dd',
  PJJ: '#0e2e6e',
  PKK: '#8b5a2b',
  PLL: '#f4c300',
}

const chave = (sigla) =>
  String(sigla || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()

const cache = new Map()

export function corPartido(sigla) {
  const k = chave(sigla)
  if (CORES[k]) return CORES[k]
  if (cache.has(k)) return cache.get(k)
  // partido sem cor cadastrada: matiz estável derivada da sigla
  let h = 0
  for (const ch of k) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const cor = `hsl(${h % 360} 55% 45%)`
  cache.set(k, cor)
  return cor
}

// Cor de texto legível sobre a cor do partido (preto ou branco, pela luminância).
export function corTexto(cor) {
  const m = /^#([0-9a-f]{6})$/i.exec(cor)
  if (!m) return '#fff'
  const n = parseInt(m[1], 16)
  const lin = (v) => {
    v /= 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
  return L > 0.179 ? '#111' : '#fff'
}
