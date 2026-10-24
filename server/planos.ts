// Planos e preços. Arquivo puro (sem imports): o servidor usa para cobrar e limitar, o front para mostrar.
// Valores em centavos de real. null = ilimitado. Edite aqui para mudar preços, nomes e limites.

export const PLANO_IDS = ['gratis', 'premium', 'completo', 'essencial', 'profissional', 'elite', 'estadual'] as const
export type PlanoId = (typeof PLANO_IDS)[number]
export const PERIODOS = ['anual', 'mensal'] as const
export type Periodo = (typeof PERIODOS)[number]

export type Plano = {
  nome: string
  grupo: 'individual' | 'comite'
  anual: number // centavos por ano (0 = grátis)
  mensal: number // centavos por mês
  pessoas: number | null // pessoas no comitê (admin, coordenadores e cabos)
  iaDia: number // consultas à 🧠 IA por dia, somadas no comitê (0 = sem IA)
  analises: boolean // área 🔒 Análises (mapa, perfil do eleitor, abstenção, idade)
  notas: boolean // 📝 notas de campanha
  relatorioEquipe: boolean // 📊 relatório de votos por liderança
  municipios: number | null // municípios que os territórios do comitê podem cobrir
  destaque?: boolean
  descricao: string[]
}

export const PLANOS: Record<PlanoId, Plano> = {
  gratis: {
    nome: 'Grátis', grupo: 'individual', anual: 0, mensal: 0, pessoas: 1, iaDia: 0, analises: false, notas: false, relatorioEquipe: false, municipios: 1,
    descricao: ['Resultados de 2012 a 2026 por município, zona, bairro, escola e seção', 'Ficha de cada candidato, comparações e histórico', 'Meu território (só no seu aparelho)'],
  },
  premium: {
    nome: 'Premium + IA', grupo: 'individual', anual: 24700, mensal: 2500, pessoas: 1, iaDia: 30, analises: true, notas: false, relatorioEquipe: false, municipios: 1,
    descricao: ['Tudo do Grátis', '🔒 Análises: mapa de votos, perfil do eleitor, abstenção e idade do eleitorado', '🧠 IA: até 30 perguntas e relatórios por dia', 'Território sincronizado entre aparelhos'],
  },
  completo: {
    nome: 'Completo', grupo: 'individual', anual: 39700, mensal: 4000, pessoas: 10, iaDia: 60, analises: true, notas: true, relatorioEquipe: true, municipios: 1, destaque: true,
    descricao: ['Tudo do Premium + IA', 'Equipe de até 10 pessoas com convites', '📊 Relatório de votos por liderança', '📝 Notas de campanha', '🧠 IA: até 60 por dia'],
  },
  essencial: {
    nome: 'Comitê Essencial', grupo: 'comite', anual: 140400, mensal: 14100, pessoas: 50, iaDia: 150, analises: true, notas: true, relatorioEquipe: true, municipios: 1,
    descricao: ['Tudo do Completo', 'Até 50 pessoas (coordenadores e cabos)', '1 município', '🧠 IA: até 150 por dia para o comitê'],
  },
  profissional: {
    nome: 'Comitê Profissional', grupo: 'comite', anual: 236400, mensal: 23700, pessoas: 150, iaDia: 400, analises: true, notas: true, relatorioEquipe: true, municipios: 1, destaque: true,
    descricao: ['Tudo do Essencial', 'Até 150 pessoas', '1 município', '🧠 IA: até 400 por dia'],
  },
  elite: {
    nome: 'Comitê Elite', grupo: 'comite', anual: 344400, mensal: 34500, pessoas: null, iaDia: 1000, analises: true, notas: true, relatorioEquipe: true, municipios: 1,
    descricao: ['Tudo do Profissional', 'Pessoas ilimitadas', '1 município', '🧠 IA: até 1.000 por dia'],
  },
  estadual: {
    nome: 'Estadual', grupo: 'comite', anual: 656400, mensal: 65700, pessoas: null, iaDia: 2000, analises: true, notas: true, relatorioEquipe: true, municipios: null,
    descricao: ['Tudo do Elite', 'Todos os municípios de Santa Catarina', 'Pessoas ilimitadas', '🧠 IA: até 2.000 por dia'],
  },
}

export const GARANTIA_DIAS = 7
export const CARENCIA_DIAS = 3 // dias depois do vencimento em que o plano ainda vale (cobrança mensal atrasada)
export const MARCA = 'Apuração SC'

export const limitesDe = (id: PlanoId) => PLANOS[id] ?? PLANOS.gratis

// plano que vale agora: o pago, enquanto não venceu (mais a carência); senão, grátis
export function planoEfetivo(c: { plano?: string | null; planoAte?: Date | string | null }, agora = new Date()): PlanoId {
  const id = (c.plano || 'gratis') as PlanoId
  if (!PLANOS[id] || id === 'gratis') return 'gratis'
  if (!c.planoAte) return id
  const ate = new Date(c.planoAte).getTime() + CARENCIA_DIAS * 86_400_000
  return ate >= agora.getTime() ? id : 'gratis'
}

export const precoBR = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
export const precoDe = (id: PlanoId, periodo: Periodo) => PLANOS[id][periodo]

// lista para o front e a API pública
export const catalogo = () => PLANO_IDS.map((id) => ({ id, ...PLANOS[id] }))
