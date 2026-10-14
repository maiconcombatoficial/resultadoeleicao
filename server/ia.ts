// 🧠 IA da campanha: perguntas e relatórios sobre os dados de votação (município, zona, bairro, local e
// seção; 2022 × 2026; abstenção; território da equipe) com o Claude (Anthropic SDK).
//
// Como funciona (RAG híbrido):
// - Os votos ficam nos arquivos estáticos do TSE já carregados no navegador. O modelo pede os números
//   por "ferramentas" (tool use); as ferramentas de dados são executadas NO NAVEGADOR (campanha.js), que
//   devolve os resultados para a próxima rodada. Assim a chave da API fica só no servidor e os 35 MB de
//   boletins não precisam ir para a função serverless.
// - As notas da equipe (banco Neon) são buscadas AQUI, por busca textual em português (tsvector).
// - A conversa inteira (inclusive blocos de thinking e chamadas de ferramentas) vai e volta a cada rodada,
//   sem edição, como a API exige (preserved thinking).
import Anthropic from '@anthropic-ai/sdk'
import { Hono } from 'hono'
import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from './db/index.ts'
import { Invalido, corpo, hojeISO, ipDe, type Vars } from './comum.ts'
import { limitar } from './limites.ts'
import { planoDoComite } from './sessao.ts'

const { conversas, iaUsos, iaUsosComite, notas, relatorios } = schema

export const MODELO = process.env.IA_MODELO || 'claude-opus-5-5'
const MAX_RODADAS_SERVIDOR = 6

let _client: Anthropic | null = null
const client = () => (_client ??= new Anthropic({ timeout: 55_000, maxRetries: 1 }))
// testes: cliente falso no lugar da API
export const definirClienteIA = (c: Anthropic | null) => (_client = c)
export const temIA = () => !!process.env.ANTHROPIC_API_KEY

/* ---------------- ferramentas ---------------- */

const CARGOS = ['presidente', 'governador', 'senador', 'depfed', 'depest'] as const
const NIVEIS = ['zona', 'bairro', 'local', 'secao'] as const
const ORDENS = ['votos', 'pct', 'crescimento', 'queda', 'posicao'] as const
const ORDENS_ABST = ['abstencao', 'ausentes', 'brancos', 'nulos', 'comparecimento'] as const

const prop = (p: Record<string, unknown>) => ({ ...p })
const cargoProp = prop({ type: 'string', enum: CARGOS, description: 'Cargo: presidente (SC), governador, senador, depfed (deputado federal) ou depest (deputado estadual).' })
const numeroProp = prop({ type: 'string', description: 'Número de urna do candidato (ex.: "22", "1310", "13999"). Descubra com listar_candidatos quando só souber o nome.' })
const limiteProp = prop({ type: ['integer', 'null'], description: 'Quantas linhas devolver (padrão 25, máximo 80).' })
const munProp = prop({ type: 'string', description: 'Nome do município de SC (ex.: "Florianópolis", "Joinville"). Aceita sem acento.' })
const nivelProp = prop({ type: 'string', enum: NIVEIS, description: 'Agrupar por zona eleitoral, bairro, local de votação (escola) ou seção (urna).' })

// executadas no navegador (dados do TSE já carregados no app)
export const FERRAMENTAS_NAVEGADOR: Anthropic.Beta.BetaTool[] = [
  {
    name: 'listar_candidatos',
    description: 'Resultado de um cargo em SC: os candidatos com número, partido, votos, % dos válidos, posição e situação (eleito, suplente, 2º turno). Use para achar o número de um candidato pelo nome e para contextualizar a disputa.',
    strict: true,
    input_schema: { type: 'object', properties: { cargo: cargoProp, busca: prop({ type: ['string', 'null'], description: 'Filtra por nome, partido ou número (opcional).' }), limite: limiteProp }, required: ['cargo', 'busca', 'limite'], additionalProperties: false },
  },
  {
    name: 'votos_por_municipio',
    description: 'Votos de um candidato em cada município de SC (ou só nos municípios de uma associação da FECAM), com % dos válidos, posição no município, votos em 2022 (mesmo candidato, pelo nome) e variação. Ordens: votos, pct, crescimento, queda, posicao. Também devolve o total do candidato em SC e a posição estadual.',
    strict: true,
    input_schema: { type: 'object', properties: { cargo: cargoProp, numero: numeroProp, ordem: prop({ type: 'string', enum: ORDENS }), limite: limiteProp, associacao: prop({ type: ['string', 'null'], description: 'Sigla de associação de municípios da FECAM (ex.: GRANFPOLIS, AMUREL, AMREC) para restringir; null para SC inteira.' }) }, required: ['cargo', 'numero', 'ordem', 'limite', 'associacao'], additionalProperties: false },
  },
  {
    name: 'votos_no_municipio',
    description: 'Votos de um candidato dentro de um município, por zona, bairro, local de votação ou seção (boletins de urna do TSE): votos, válidos, % do candidato, posição na disputa daquele lugar, quem foi o 1º colocado ali e a diferença; quando há dados, aptos, comparecimento e abstenção do lugar. Ordens: votos, pct, posicao.',
    strict: true,
    input_schema: { type: 'object', properties: { cargo: cargoProp, numero: numeroProp, municipio: munProp, nivel: nivelProp, ordem: prop({ type: 'string', enum: ORDENS }), limite: limiteProp, bairro: prop({ type: ['string', 'null'], description: 'Restringe a um bairro (para listar as escolas ou seções dele); null para o município inteiro.' }) }, required: ['cargo', 'numero', 'municipio', 'nivel', 'ordem', 'limite', 'bairro'], additionalProperties: false },
  },
  {
    name: 'bairros_sc',
    description: 'Os bairros de todo o estado onde um candidato foi mais votado (votos, % do bairro, 2022 e variação). Ordens: votos, pct, crescimento, queda.',
    strict: true,
    input_schema: { type: 'object', properties: { cargo: cargoProp, numero: numeroProp, ordem: prop({ type: 'string', enum: ORDENS }), limite: limiteProp }, required: ['cargo', 'numero', 'ordem', 'limite'], additionalProperties: false },
  },
  {
    name: 'abstencao_no_municipio',
    description: 'Aptos, comparecimento, abstenção, brancos e nulos num município por zona, bairro, local ou seção, para um cargo. Serve para achar lugares com muitos eleitores que não votaram (potencial de mobilização) ou muitos brancos/nulos. Ordens: abstencao, ausentes, brancos, nulos, comparecimento.',
    strict: true,
    input_schema: { type: 'object', properties: { municipio: munProp, cargo: cargoProp, nivel: nivelProp, ordem: prop({ type: 'string', enum: ORDENS_ABST }), limite: limiteProp }, required: ['municipio', 'cargo', 'nivel', 'ordem', 'limite'], additionalProperties: false },
  },
  {
    name: 'comparar_no_lugar',
    description: 'Compara 2 ou 3 candidatos do mesmo cargo lado a lado: por município em SC (municipio = null) ou, num município, por zona, bairro, local ou seção. Mostra os votos de cada um, quem ficou na frente e a diferença. Ordens: votos (mais votos somados), "diferenca" não existe: use ordem "posicao" para os lugares mais disputados.',
    strict: true,
    input_schema: { type: 'object', properties: { cargo: cargoProp, numeros: prop({ type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 3, description: 'Números de urna dos candidatos.' }), municipio: prop({ type: ['string', 'null'], description: 'Município, ou null para comparar por município em SC.' }), nivel: prop({ type: ['string', 'null'], enum: [...NIVEIS, null], description: 'Nível dentro do município (ignorado quando municipio é null).' }), limite: limiteProp }, required: ['cargo', 'numeros', 'municipio', 'nivel', 'limite'], additionalProperties: false },
  },
  {
    name: 'equipe_territorios',
    description: 'O que a equipe da campanha entregou: para cada coordenador e cabo eleitoral com território marcado, os locais e seções, os votos do candidato do comitê ali, % dos válidos, posição, meta e 2022 nas mesmas seções; as seções marcadas por mais de uma pessoa; e o total da equipe contra o total do candidato. Exige que o comitê tenha escolhido o candidato.',
    strict: true,
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
]

// executadas aqui no servidor (banco Neon)
const FERRAMENTAS_SERVIDOR: Anthropic.Beta.BetaTool[] = [
  {
    name: 'buscar_notas',
    description: 'Busca nas notas de campanha escritas pela própria equipe (reuniões, lideranças locais, demandas de bairros, compromissos). Use para cruzar os números do TSE com o que a equipe sabe do território. Devolve as notas mais relevantes com data, autor e lugar.',
    strict: true,
    input_schema: { type: 'object', properties: { consulta: prop({ type: 'string', description: 'Palavras-chave (bairro, município, tema, nome).' }), limite: limiteProp }, required: ['consulta', 'limite'], additionalProperties: false },
  },
  {
    name: 'listar_relatorios',
    description: 'Lista os relatórios já salvos pelo comitê (título e data) e, com id, devolve o conteúdo de um deles.',
    strict: true,
    input_schema: { type: 'object', properties: { id: prop({ type: ['integer', 'null'], description: 'id do relatório para ler o conteúdo; null para só listar.' }) }, required: ['id'], additionalProperties: false },
  },
]
const NOMES_SERVIDOR = new Set(FERRAMENTAS_SERVIDOR.map((f) => f.name))

/* ---------------- prompt ---------------- */

const SISTEMA_FIXO = `Você é a analista de dados eleitorais do comitê de campanha, dentro do app "Apuração 2026 SC". Responde sempre em português do Brasil, de forma direta, com números concretos e fontes claras.

O QUE VOCÊ TEM
- Resultados oficiais do TSE das Eleições Gerais 2026 em Santa Catarina (1º turno), por candidato: município, zona eleitoral, bairro, local de votação (escola) e seção (urna), lidos dos boletins de urna. Também aptos, comparecimento, abstenção, brancos e nulos.
- A eleição de 2022 nos mesmos lugares (mesmo candidato, ligado pelo nome), para medir crescimento e queda.
- O território da equipe (escolas e seções onde cada coordenador e cabo eleitoral trabalhou) e as notas escritas pela equipe.
- Ferramentas para consultar tudo isso. Use-as sempre que precisar de um número: nunca invente, estime ou "lembre" votos. Se uma ferramenta devolver erro ou vazio, diga isso e ajuste a consulta (ex.: ache o número do candidato com listar_candidatos; confira a grafia do município).

COMO TRABALHAR
- Comece entendendo a pergunta. Se faltar o candidato ou o cargo, use o candidato do comitê (no contexto) ou pergunte.
- Faça as consultas necessárias (pode chamar várias ferramentas de uma vez). Prefira poucas consultas bem escolhidas a muitas.
- Analise como uma estrategista: redutos (onde o candidato tem % alto), potencial não aproveitado (bairros/municípios grandes com % baixo mas com crescimento ou com candidatos "parecidos" fortes), onde caiu desde 2022, lugares com abstenção alta (mobilização), urnas onde ficou em 2º por pouco, concentração de votos (dependência de poucos lugares) e o que a equipe entregou × meta.
- Oportunidades são hipóteses: apresente-as com o número que as sustenta e diga o que confirmar em campo. Deixe claro o que é estimativa (o voto é secreto; comparações por seção são ecológicas, não individuais).
- Relatórios: use títulos curtos, tabelas Markdown para os números (no máximo ~15 linhas por tabela), e termine com "Próximos passos" objetivos. Textos curtos: frases diretas, sem floreio.
- Não dê orientações ilegais (compra de votos, uso de recursos públicos, propaganda fora das regras) e não trate dados pessoais de eleitores: a análise é sempre por lugar (bairro, escola, seção), nunca por pessoa.`

function sistemaDoContexto(ctx: Contexto) {
  const partes = [`Hoje é ${ctx.hoje}.`]
  if (ctx.comite) partes.push(`Comitê: ${ctx.comite}.`)
  if (ctx.candidato) partes.push(`Candidato do comitê: ${ctx.candidato.nome} (${ctx.candidato.partido}), nº ${ctx.candidato.numero}, cargo ${ctx.candidato.cargo}.`)
  else partes.push('O comitê ainda não escolheu o candidato: pergunte de quem se trata quando necessário.')
  partes.push(`Quem pergunta: ${ctx.usuario} (${ctx.papel}).`)
  if (ctx.turno2) partes.push('Os boletins do 2º turno já estão no app; o 1º turno continua disponível.')
  return partes.join(' ')
}

/* ---------------- rota ---------------- */

const zCandidato = z.object({ nome: z.string(), partido: z.string(), numero: z.string(), cargo: z.string() }).nullable()
const zContexto = z.object({ comite: z.string().max(80).nullable().optional(), candidato: zCandidato.optional(), turno2: z.boolean().optional() })
type Contexto = { hoje: string; comite?: string | null; candidato?: z.infer<typeof zCandidato>; usuario: string; papel: string; turno2?: boolean }

export const ia = new Hono<{ Variables: Vars }>()

ia.get('/estado', async (c) => {
  const u = c.get('usuario')
  const P = await planoDoComite(u.comiteId)
  const [uso] = await db().select({ n: iaUsosComite.n }).from(iaUsosComite).where(and(eq(iaUsosComite.comiteId, u.comiteId), eq(iaUsosComite.dia, hojeISO())))
  return c.json({ disponivel: temIA() && P.limites.iaDia > 0, configurada: temIA(), modelo: MODELO, limiteDia: P.limites.iaDia, usadosHoje: uso?.n || 0, plano: P.id, planoNome: P.nome })
})

ia.post('/chat', async (c) => {
  const u = c.get('usuario')
  // o plano do comitê define se há IA e quantas consultas por dia (somadas no comitê)
  const P = await planoDoComite(u.comiteId)
  if (P.limites.iaDia <= 0) return c.json({ erro: `O plano ${P.nome} não inclui a 🧠 IA. Veja os planos em 💳 Plano.`, codigo: 'plano' }, 403)
  await limitar(`ia:${u.id}`, 20, 60, 'Muitas perguntas seguidas. Aguarde um minuto.')
  await limitar(`ia-ip:${ipDe(c)}`, 60, 60)
  const d = await corpo(c, z.object({ mensagens: z.array(z.any()).min(1).max(400), contexto: zContexto.optional() }))
  const dia = hojeISO()
  const [usoC] = await db()
    .insert(iaUsosComite)
    .values({ comiteId: u.comiteId, dia, n: 1 })
    .onConflictDoUpdate({ target: [iaUsosComite.comiteId, iaUsosComite.dia], set: { n: sql`${iaUsosComite.n} + 1` } })
    .returning({ n: iaUsosComite.n })
  if (usoC.n > P.limites.iaDia) return c.json({ erro: `O comitê já usou as ${P.limites.iaDia} consultas de hoje do plano ${P.nome}. Amanhã libera de novo, ou faça upgrade em 💳 Plano.`, codigo: 'plano' }, 429)
  // estatística por pessoa
  await db().insert(iaUsos).values({ usuarioId: u.id, dia, n: 1 }).onConflictDoUpdate({ target: [iaUsos.usuarioId, iaUsos.dia], set: { n: sql`${iaUsos.n} + 1` } })
  if (!temIA()) return c.json({ erro: 'A IA não está configurada neste servidor (ANTHROPIC_API_KEY).' }, 503)

  const contexto: Contexto = { hoje: new Date().toLocaleDateString('pt-BR', { dateStyle: 'long' }), comite: d.contexto?.comite ?? null, candidato: d.contexto?.candidato ?? null, usuario: u.nome, papel: u.papel, turno2: d.contexto?.turno2 }
  const mensagens = d.mensagens as Anthropic.Beta.BetaMessageParam[]
  const resultadosServidor: Anthropic.Beta.BetaToolResultBlockParam[] = []
  let usoTotal = { entrada: 0, saida: 0 }

  for (let rodada = 0; rodada < MAX_RODADAS_SERVIDOR; rodada++) {
    const resp = await client().beta.messages.create({
      model: MODELO,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: [
        { type: 'text', text: SISTEMA_FIXO, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: sistemaDoContexto(contexto) },
      ],
      tools: [...FERRAMENTAS_NAVEGADOR, ...FERRAMENTAS_SERVIDOR],
      messages: mensagens,
    })
    usoTotal = { entrada: usoTotal.entrada + resp.usage.input_tokens, saida: usoTotal.saida + resp.usage.output_tokens }
    const chamadas = resp.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
    const doServidor = chamadas.filter((t) => NOMES_SERVIDOR.has(t.name))
    const doNavegador = chamadas.filter((t) => !NOMES_SERVIDOR.has(t.name))
    // executa as ferramentas do servidor
    const feitos: Anthropic.Beta.BetaToolResultBlockParam[] = []
    for (const t of doServidor) {
      try {
        feitos.push({ type: 'tool_result', tool_use_id: t.id, content: JSON.stringify(await executarNoServidor(u.comiteId, t.name, t.input as Record<string, unknown>)) })
      } catch (e) {
        feitos.push({ type: 'tool_result', tool_use_id: t.id, content: `Erro: ${(e as Error).message}`, is_error: true })
      }
    }
    if (resp.stop_reason === 'tool_use' && doNavegador.length === 0 && feitos.length) {
      // só ferramentas do servidor: fecha a rodada aqui mesmo e continua
      mensagens.push({ role: 'assistant', content: resp.content })
      mensagens.push({ role: 'user', content: feitos })
      continue
    }
    // devolve ao navegador: ele executa as ferramentas de dados e manda tudo de volta na próxima chamada
    return c.json({
      conteudo: resp.content,
      parar: resp.stop_reason,
      detalhe: resp.stop_reason === 'refusal' ? resp.stop_details : null,
      resultadosServidor: [...resultadosServidor, ...feitos],
      pendentes: doNavegador.map((t) => ({ id: t.id, name: t.name, input: t.input })),
      mensagensServidor: mensagens.slice(d.mensagens.length), // rodadas fechadas aqui (ferramentas do servidor)
      modelo: resp.model,
      uso: usoTotal,
    })
  }
  return c.json({ erro: 'A IA fez consultas demais numa só pergunta. Tente uma pergunta mais específica.' }, 500)
})

async function executarNoServidor(comiteId: number, nome: string, input: Record<string, unknown>) {
  const D = db()
  if (nome === 'buscar_notas') {
    const q = String(input.consulta || '').trim()
    const lim = Math.min(Number(input.limite) || 10, 40)
    if (!q) return { notas: [] }
    const ls = await D
      .select({ id: notas.id, texto: notas.texto, lugar: notas.lugar, criadaEm: notas.criadaEm, autor: schema.usuarios.nome })
      .from(notas)
      .leftJoin(schema.usuarios, eq(schema.usuarios.id, notas.usuarioId))
      .where(and(eq(notas.comiteId, comiteId), sql`(${notas.busca} @@ plainto_tsquery('portuguese', ${q}) or ${notas.texto} ilike ${'%' + q + '%'} or coalesce(${notas.lugar}, '') ilike ${'%' + q + '%'})`))
      .orderBy(desc(notas.criadaEm))
      .limit(lim)
    return { consulta: q, notas: ls.map((n) => ({ id: n.id, data: n.criadaEm.toISOString().slice(0, 10), autor: n.autor, lugar: n.lugar, texto: n.texto })) }
  }
  if (nome === 'listar_relatorios') {
    const id = input.id == null ? null : Number(input.id)
    if (id) {
      const [r] = await D.select().from(relatorios).where(and(eq(relatorios.id, id), eq(relatorios.comiteId, comiteId)))
      return r ? { id: r.id, titulo: r.titulo, data: r.criadoEm.toISOString().slice(0, 10), conteudo: r.conteudo } : { erro: 'Relatório não encontrado' }
    }
    const ls = await D.select({ id: relatorios.id, titulo: relatorios.titulo, criadoEm: relatorios.criadoEm }).from(relatorios).where(eq(relatorios.comiteId, comiteId)).orderBy(desc(relatorios.criadoEm)).limit(50)
    return { relatorios: ls.map((r) => ({ id: r.id, titulo: r.titulo, data: r.criadoEm.toISOString().slice(0, 10) })) }
  }
  throw new Invalido(`Ferramenta desconhecida: ${nome}`)
}

/* ---------------- conversas salvas ---------------- */

const zMensagens = z.array(z.any()).max(400)

ia.get('/conversas', async (c) => {
  const u = c.get('usuario')
  const ls = await db().select({ id: conversas.id, titulo: conversas.titulo, atualizadaEm: conversas.atualizadaEm }).from(conversas).where(eq(conversas.usuarioId, u.id)).orderBy(desc(conversas.atualizadaEm)).limit(30)
  return c.json(ls)
})
ia.get('/conversas/:id', async (c) => {
  const u = c.get('usuario')
  const [cv] = await db().select().from(conversas).where(and(eq(conversas.id, Number(c.req.param('id'))), eq(conversas.usuarioId, u.id)))
  if (!cv) throw new Invalido('Conversa não encontrada.')
  return c.json(cv)
})
ia.post('/conversas', async (c) => {
  const u = c.get('usuario')
  const d = await corpo(c, z.object({ titulo: z.string().trim().min(1).max(120), mensagens: zMensagens }))
  const [cv] = await db().insert(conversas).values({ comiteId: u.comiteId, usuarioId: u.id, titulo: d.titulo, mensagens: d.mensagens }).returning()
  return c.json(cv, 201)
})
ia.put('/conversas/:id', async (c) => {
  const u = c.get('usuario')
  const d = await corpo(c, z.object({ titulo: z.string().trim().min(1).max(120).optional(), mensagens: zMensagens }))
  const [cv] = await db()
    .update(conversas)
    .set({ mensagens: d.mensagens, ...(d.titulo ? { titulo: d.titulo } : {}), atualizadaEm: new Date() })
    .where(and(eq(conversas.id, Number(c.req.param('id'))), eq(conversas.usuarioId, u.id)))
    .returning()
  if (!cv) throw new Invalido('Conversa não encontrada.')
  return c.json(cv)
})
ia.delete('/conversas/:id', async (c) => {
  const u = c.get('usuario')
  await db().delete(conversas).where(and(eq(conversas.id, Number(c.req.param('id'))), eq(conversas.usuarioId, u.id)))
  return c.json({ ok: true })
})
