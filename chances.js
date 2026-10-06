// Chance de reverter a situação com as urnas que ainda faltam apurar.
//
// Votos que faltam (R): votos válidos já apurados × (% de seções que faltam ÷ % apurado).
// Ritmo: a fatia dos votos válidos que o candidato tem até agora (s = votos ÷ válidos).
//
// Majoritários (Presidente, Governador, Senado) — conta exata:
//   - fora da vaga e diferença > R  → matematicamente fora (nem com todos os votos que faltam)
//   - dentro da vaga e vantagem > R → vaga garantida (nem que o rival leve todos os votos que faltam)
// Proporcionais (Deputados): usa o cálculo do TSE (vagas.js) para achar quantos votos a mais
// elegeriam o candidato (ou quantos a menos o tirariam), com os demais parados.
//
// Nos casos não definidos, compara o desempenho que o candidato precisaria ter nas urnas que faltam
// com o desempenho atual dele, supondo que os demais mantenham o próprio ritmo:
//   multiplicador ≤ 1,1 → pode reverter · ≤ 1,5 → reversão difícil · acima → improvável.

import { votosParaEleger, folgaDaVaga } from './vagas.js?v=202610080700'

export const NIVEIS = {
  garantido: { rotulo: 'Garantido', icone: '✅', classe: 'ch-garantido' },
  segura: { rotulo: 'Vaga segura', icone: '🛡️', classe: 'ch-segura' },
  provavel: { rotulo: 'Vaga provável', icone: '👍', classe: 'ch-provavel' },
  risco: { rotulo: 'Vaga em risco', icone: '⚠️', classe: 'ch-risco' },
  pode: { rotulo: 'Pode reverter', icone: '🔄', classe: 'ch-pode' },
  dificil: { rotulo: 'Reversão difícil', icone: '⏳', classe: 'ch-dificil' },
  improvavel: { rotulo: 'Reversão improvável', icone: '📉', classe: 'ch-improvavel' },
  fora: { rotulo: 'Sem chance', icone: '❌', classe: 'ch-fora' },
}

const nivelDentro = (f) => (f <= 0 ? 'segura' : f < 0.8 ? 'provavel' : 'risco')
const nivelFora = (m) => (m <= 1.1 ? 'pode' : m <= 1.5 ? 'dificil' : 'improvavel')

/** Votos válidos que ainda faltam apurar (estimativa) e os já apurados. */
export function votosRestantes(d, validos) {
  const { total, totalizadas, percentual } = d.secoes
  // usa o % de seções totalizadas informado pelo TSE; seções/total só como reserva
  const p = percentual > 0 ? percentual / 100 : total ? totalizadas / total : 0
  if (!(p > 0) || p >= 1) return 0
  return Math.round((validos * (1 - p)) / p)
}

function majoritario(d, c, vagas) {
  const validos = d.candidatos.filter((x) => x.valido).reduce((a, x) => a + x.votos, 0)
  const R = votosRestantes(d, validos)
  const lista = d.candidatos.filter((x) => x.valido)
  const pos = lista.indexOf(c)
  if (pos < 0 || !validos || !R) return null
  const s = c.votos / validos
  if (pos < vagas) {
    const rival = lista[vagas]
    if (!rival) return { nivel: 'garantido', R, exato: true, texto: 'Não há quem possa alcançá-lo.' }
    const vantagem = c.votos - rival.votos
    if (vantagem > R) return { nivel: 'garantido', R, exato: true, vantagem, rival, texto: `A vantagem de ${vantagem} votos sobre ${rival.nome} é maior que todos os votos que faltam.` }
    const f = s > 0 ? (rival.votos / validos - vantagem / R) / s : Infinity
    return { nivel: nivelDentro(f), R, vantagem, rival, f }
  }
  const alvo = lista[vagas - 1]
  const falta = alvo.votos - c.votos + 1
  if (falta > R) return { nivel: 'fora', R, exato: true, falta, rival: alvo }
  const m = s > 0 ? (alvo.votos / validos + falta / R) / s : Infinity
  return { nivel: nivelFora(m), R, falta, rival: alvo, m }
}

function proporcional(d, c, entrada) {
  const r = d.projecao
  if (!r?.qe) return null
  const V = r.validos
  const R = votosRestantes(d, V)
  if (!R || !V) return null
  const s = c.votos / V
  const fator = (V + R) / V
  if (c.projecao) {
    const y = folgaDaVaga(entrada, c.sqcand, c.votos)
    if (y === Infinity) return { nivel: 'segura', R, folga: y, f: -Infinity }
    const f = s > 0 ? ((c.votos - y) * fator - c.votos) / (s * R) : Infinity
    return { nivel: nivelDentro(f), R, folga: y, f }
  }
  const x = votosParaEleger(entrada, c.sqcand, R)
  if (x == null) return { nivel: 'fora', R, falta: null }
  const m = s > 0 ? ((c.votos + x) * fator - c.votos) / (s * R) : Infinity
  return { nivel: nivelFora(m), R, falta: x, m }
}

/**
 * Calcula (com cache por leitura) a chance de reverter de um candidato.
 * @param d dados normalizados (com d.projecao para deputados)
 * @param c candidato
 * @param tipo 'maj' | 'prop'
 * @param vagasMaj número de posições que garantem o objetivo (1, 2 no Senado, 2 para ir ao 2º turno)
 */
export function chanceDe(d, c, tipo, vagasMaj) {
  if (d.final || !c.valido) return null
  d._chances ??= new Map()
  if (d._chances.has(c.sqcand)) return d._chances.get(c.sqcand)
  let res = null
  if (tipo === 'maj') res = majoritario(d, c, vagasMaj)
  else {
    d._entrada ??= {
      vagas: d.vagas,
      grupos: d.projecao.grupos.map((g) => ({ nome: g.nome, legenda: g.legenda, candidatos: g.cands })),
    }
    res = proporcional(d, c, d._entrada)
  }
  d._chances.set(c.sqcand, res)
  return res
}
