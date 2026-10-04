// Distribuição das vagas de deputado (sistema proporcional), como faz o TSE.
//
// Código Eleitoral (Lei 4.737/1965), com a redação da Lei 14.211/2021 e a decisão do STF nas
// ADIs 7228, 7263 e 7325 (fev/2024), aplicada desde as eleições de 2024:
//
//  1. Quociente eleitoral (art. 106): votos válidos (nominais + legenda) ÷ vagas,
//     desprezada a fração se igual ou inferior a meio, arredondada para 1 se superior.
//  2. Quociente partidário (art. 107): votos do partido/federação ÷ QE, desprezada a fração.
//     Essas vagas vão aos candidatos mais votados da legenda com pelo menos 10% do QE (art. 108).
//  3. Sobras, 2ª fase (art. 109, I e II, §2º): cada vaga restante vai para a maior média
//     (votos ÷ (vagas obtidas + 1)) entre os partidos com pelo menos 80% do QE que tenham
//     candidato com pelo menos 20% do QE.
//  4. Sobras, 3ª fase (art. 109, III, conforme o STF): quando ninguém mais cumpre essas
//     exigências, as vagas restantes vão pela maior média entre todos os partidos/federações,
//     ao seu candidato mais votado ainda não eleito, sem exigência de votação mínima.
//  5. Se nenhum partido alcançar o QE (art. 111), elegem-se os mais votados.
//
// Federações contam como um único partido. Empates: na média, vence a legenda com mais votos;
// entre candidatos, o mais idoso (art. 110), quando a data de nascimento estiver disponível.

function nascimento(dt) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dt || '')
  return m ? Number(m[3] + m[2] + m[1]) : Infinity
}

const ordemCandidatos = (a, b) => b.votos - a.votos || nascimento(a.dt) - nascimento(b.dt)

export function quocienteEleitoral(validos, vagas) {
  if (!vagas || validos <= 0) return 0
  const q = validos / vagas
  const inteiro = Math.floor(q)
  return q - inteiro > 0.5 ? inteiro + 1 : inteiro
}

/**
 * @param {{ vagas: number, grupos: { nome: string, legenda: number, candidatos: { sqcand: string, votos: number, valido?: boolean, dt?: string }[] }[] }} entrada
 * @returns resultado com QE, cada grupo (votos, QP, vagas por fase) e o mapa sqcand → forma de eleição
 */
export function calcularVagas({ vagas, grupos }) {
  const gs = grupos.map((g) => {
    const cands = g.candidatos.filter((c) => c.valido !== false).sort(ordemCandidatos)
    const nominais = cands.reduce((a, c) => a + c.votos, 0)
    const legenda = Math.max(0, g.legenda || 0)
    return { nome: g.nome, nominais, legenda, votos: nominais + legenda, cands, eleitos: [], qp: 0, porQP: 0, porMedia: 0 }
  })
  const validos = gs.reduce((a, g) => a + g.votos, 0)
  const qe = quocienteEleitoral(validos, vagas)
  const eleitos = new Map() // sqcand → { forma, grupo, ordem }
  const resultado = { vagas, validos, qe, grupos: gs, eleitos, fase3: 0, semQuociente: false }
  if (!qe) return resultado

  const minimo10 = 0.1 * qe
  const minimo20 = 0.2 * qe
  const minimo80 = 0.8 * qe
  let ordem = 0
  const eleger = (g, c, forma) => {
    g.eleitos.push(c)
    eleitos.set(c.sqcand, { forma, grupo: g.nome, ordem: ++ordem })
  }
  const proximo = (g, minimo) => g.cands.find((c) => !eleitos.has(c.sqcand) && c.votos >= minimo)

  // art. 111: nenhum partido atingiu o QE → os mais votados
  if (gs.every((g) => g.votos < qe)) {
    resultado.semQuociente = true
    const todos = gs.flatMap((g) => g.cands.map((c) => ({ g, c }))).sort((a, b) => ordemCandidatos(a.c, b.c))
    for (const { g, c } of todos.slice(0, vagas)) eleger(g, c, 'mais votado (art. 111)')
    return resultado
  }

  // 1ª fase: quociente partidário
  for (const g of gs) {
    g.qp = Math.floor(g.votos / qe)
    for (let i = 0; i < g.qp; i++) {
      const c = proximo(g, minimo10)
      if (!c) break
      eleger(g, c, 'QP')
      g.porQP++
    }
  }

  let restantes = vagas - eleitos.size
  const media = (g) => g.votos / (g.eleitos.length + 1)
  const melhor = (candidatos) =>
    candidatos.reduce((m, g) => (!m || media(g) > media(m) || (media(g) === media(m) && g.votos > m.votos) ? g : m), null)

  // 2ª fase: maiores médias com as exigências de 80% / 20% do QE
  while (restantes > 0) {
    const g = melhor(gs.filter((x) => x.votos >= minimo80 && proximo(x, minimo20)))
    if (!g) break
    eleger(g, proximo(g, minimo20), 'média')
    g.porMedia++
    restantes--
  }

  // 3ª fase (STF, ADIs 7228/7263/7325): todos os partidos e candidatos
  while (restantes > 0) {
    const g = melhor(gs.filter((x) => proximo(x, 1)))
    if (!g) break
    eleger(g, proximo(g, 1), 'média (3ª fase)')
    g.porMedia++
    resultado.fase3++
    restantes--
  }
  return resultado
}

// Recalcula as vagas com os votos de um candidato alterados em `delta` (o resto fica igual).
function eleitoCom(entrada, sqcand, delta) {
  const grupos = entrada.grupos.map((g) =>
    g.candidatos.some((c) => c.sqcand === sqcand)
      ? { ...g, candidatos: g.candidatos.map((c) => (c.sqcand === sqcand ? { ...c, votos: Math.max(0, c.votos + delta) } : c)) }
      : g,
  )
  return calcularVagas({ vagas: entrada.vagas, grupos }).eleitos.has(sqcand)
}

/**
 * Menor número de votos a mais que elegeria o candidato, com os votos dos demais parados.
 * Devolve null se nem com `limite` votos a mais ele entraria.
 */
export function votosParaEleger(entrada, sqcand, limite) {
  if (eleitoCom(entrada, sqcand, 0)) return 0
  if (!(limite > 0) || !eleitoCom(entrada, sqcand, limite)) return null
  let lo = 0, hi = limite
  const passo = Math.max(1, Math.floor(limite / 4000))
  while (hi - lo > passo) {
    const meio = Math.floor((lo + hi) / 2)
    if (eleitoCom(entrada, sqcand, meio)) hi = meio
    else lo = meio
  }
  return hi
}

/** Quantos votos o candidato eleito poderia perder (demais parados) antes de sair. Infinity se nunca sai. */
export function folgaDaVaga(entrada, sqcand, votosAtuais) {
  if (!eleitoCom(entrada, sqcand, 0)) return 0
  if (eleitoCom(entrada, sqcand, -votosAtuais)) return Infinity
  let lo = 0, hi = votosAtuais
  const passo = Math.max(1, Math.floor(votosAtuais / 4000))
  while (hi - lo > passo) {
    const meio = Math.floor((lo + hi) / 2)
    if (eleitoCom(entrada, sqcand, -meio)) lo = meio
    else hi = meio
  }
  return lo
}
