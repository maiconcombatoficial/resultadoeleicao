// Votação no exterior: as cidades (zonas eleitorais) cadastradas pelo TSE agrupadas por país, com o fuso
// horário de cada uma. O brasileiro no exterior vota no horário local, das 8h às 17h do dia da eleição;
// por isso a Austrália já está votando quando no Brasil ainda é madrugada. O TSE só divulga a apuração
// depois das 17h de Brasília.

// [país, fuso (IANA), [códigos TSE das cidades]]
export const EXTERIOR = [
  ['Albânia', 'Europe/Tirane', [99139]],
  ['Alemanha', 'Europe/Berlin', [29386, 29696, 30180]],
  ['Angola', 'Africa/Luanda', [29998]],
  ['Antígua e Barbuda', 'America/Antigua', [99147]],
  ['Arábia Saudita', 'Asia/Riyadh', [30422]],
  ['Argélia', 'Africa/Algiers', [29300]],
  ['Argentina', 'America/Argentina/Buenos_Aires', [29467, 29602, 39004, 30295, 99155]],
  ['Armênia', 'Asia/Yerevan', [38989]],
  ['Austrália', 'Australia/Sydney', [29491, 30562]],
  ['Áustria', 'Europe/Vienna', [30767]],
  ['Azerbaijão', 'Asia/Baku', [39128]],
  ['Bahamas', 'America/Nassau', [99180]],
  ['Bahrein', 'Asia/Bahrain', [99473]],
  ['Bangladesh', 'Asia/Dhaka', [29629]],
  ['Barbados', 'America/Barbados', [29424]],
  ['Bélgica', 'Europe/Brussels', [29432]],
  ['Belize', 'America/Belize', [38881]],
  ['Benim', 'Africa/Porto-Novo', [38920]],
  ['Bolívia', 'America/La_Paz', [99210, 29572, 29904, 99236, 30473]],
  ['Bósnia e Herzegovina', 'Europe/Sarajevo', [30988]],
  ['Botsuana', 'Africa/Gaborone', [30669]],
  ['Bulgária', 'Europe/Sofia', [30546]],
  ['Burkina Faso', 'Africa/Ouagadougou', [39284]],
  ['Cabo Verde', 'Atlantic/Cape_Verde', [30368]],
  ['Camarões', 'Africa/Douala', [29815]],
  ['Canadá', 'America/Toronto', [30155, 30252, 30635]],
  ['Canadá (Vancouver)', 'America/Vancouver', [39063]],
  ['Catar', 'Asia/Qatar', [29653]],
  ['Cazaquistão', 'Asia/Almaty', [39241]],
  ['Chile', 'America/Santiago', [30481]],
  ['China', 'Asia/Shanghai', [30651, 30317, 30848, 29793]],
  ['Chipre', 'Asia/Nicosia', [39322]],
  ['Colômbia', 'America/Bogota', [29408]],
  ['Coreia do Norte', 'Asia/Pyongyang', [99295]],
  ['Coreia do Sul', 'Asia/Seoul', [30538]],
  ['Costa do Marfim', 'Africa/Abidjan', [29254]],
  ['Costa Rica', 'America/Costa_Rica', [30511]],
  ['Croácia', 'Europe/Zagreb', [39020]],
  ['Cuba', 'America/Havana', [29777]],
  ['Dinamarca', 'Europe/Copenhagen', [29599]],
  ['Egito', 'Africa/Cairo', [29483]],
  ['El Salvador', 'America/El_Salvador', [30520]],
  ['Emirados Árabes Unidos', 'Asia/Dubai', [29262]],
  ['Equador', 'America/Guayaquil', [30392]],
  ['Eslováquia', 'Europe/Bratislava', [39209]],
  ['Eslovênia', 'Europe/Ljubljana', [39160]],
  ['Espanha', 'Europe/Madrid', [29351, 30066]],
  ['Estados Unidos (costa leste)', 'America/New_York', [39080, 29416, 30902, 30112, 30228, 99490, 30783]],
  ['Estados Unidos (centro)', 'America/Chicago', [29513, 29807]],
  ['Estados Unidos (costa oeste)', 'America/Los_Angeles', [29980, 30503]],
  ['Estônia', 'Europe/Tallinn', [99317]],
  ['Etiópia', 'Africa/Addis_Ababa', [99325]],
  ['Filipinas', 'Asia/Manila', [30082]],
  ['Finlândia', 'Europe/Helsinki', [29785]],
  ['França', 'Europe/Paris', [30287, 99511]],
  ['Gabão', 'Africa/Libreville', [29939]],
  ['Gana', 'Africa/Accra', [29270]],
  ['Geórgia', 'Asia/Tbilisi', [99104]],
  ['Grécia', 'Europe/Athens', [29335]],
  ['Guatemala', 'America/Guatemala', [98000]],
  ['Guiana', 'America/Guyana', [29718]],
  ['Guiana Francesa', 'America/Cayenne', [29475, 99333]],
  ['Guiné', 'Africa/Conakry', [38903]],
  ['Guiné Equatorial', 'Africa/Malabo', [39263]],
  ['Guiné-Bissau', 'Africa/Bissau', [29394]],
  ['Haiti', 'America/Port-au-Prince', [30333]],
  ['Honduras', 'America/Tegucigalpa', [30600]],
  ['Hungria', 'Europe/Budapest', [29459]],
  ['Índia', 'Asia/Kolkata', [30171, 30210]],
  ['Indonésia', 'Asia/Jakarta', [29840]],
  ['Irã', 'Asia/Tehran', [30597]],
  ['Iraque', 'Asia/Baghdad', [99171]],
  ['Irlanda', 'Europe/Dublin', [29661]],
  ['Israel', 'Asia/Jerusalem', [30619]],
  ['Itália', 'Europe/Rome', [30120, 30449]],
  ['Jamaica', 'America/Jamaica', [99430]],
  ['Japão', 'Asia/Tokyo', [29742, 30198, 30627]],
  ['Jordânia', 'Asia/Amman', [29289]],
  ['Kuwait', 'Asia/Kuwait', [29882]],
  ['Líbano', 'Asia/Beirut', [29360]],
  ['Líbia', 'Africa/Tripoli', [30686]],
  ['Malásia', 'Asia/Kuala_Lumpur', [29890]],
  ['Malauí', 'Africa/Blantyre', [99341]],
  ['Mali', 'Africa/Bamako', [99350]],
  ['Marrocos', 'Africa/Casablanca', [30406]],
  ['México', 'America/Mexico_City', [30104]],
  ['Mianmar', 'Asia/Yangon', [99376]],
  ['Moçambique', 'Africa/Maputo', [30090]],
  ['Namíbia', 'Africa/Windhoek', [30821]],
  ['Nepal', 'Asia/Kathmandu', [29173]],
  ['Nicarágua', 'America/Managua', [30074]],
  ['Nigéria', 'Africa/Lagos', [99198, 29912]],
  ['Noruega', 'Europe/Oslo', [30244]],
  ['Nova Zelândia', 'Pacific/Auckland', [30805]],
  ['Omã', 'Asia/Muscat', [39102]],
  ['Países Baixos', 'Europe/Amsterdam', [30457]],
  ['Palestina', 'Asia/Hebron', [30414]],
  ['Panamá', 'America/Panama', [30260]],
  ['Paquistão', 'Asia/Karachi', [29831]],
  ['Paraguai', 'America/Asuncion', [29327, 29556, 29580, 29670, 30309, 30465]],
  ['Peru', 'America/Lima', [29823, 29947]],
  ['Polônia', 'Europe/Warsaw', [30740]],
  ['Portugal', 'Europe/Lisbon', [30961, 29955, 30341]],
  ['Quênia', 'Africa/Nairobi', [30201]],
  ['Reino Unido', 'Europe/London', [99503, 29971]],
  ['República Dominicana', 'America/Santo_Domingo', [30490]],
  ['República do Congo', 'Africa/Brazzaville', [39187]],
  ['RD Congo (Kinshasa)', 'Africa/Kinshasa', [29874]],
  ['Romênia', 'Europe/Bucharest', [29440]],
  ['Rússia', 'Europe/Moscow', [30163]],
  ['Santa Lúcia', 'America/St_Lucia', [99384]],
  ['São Tomé e Príncipe', 'Africa/Sao_Tome', [39225]],
  ['Senegal', 'Africa/Dakar', [29610]],
  ['Sérvia', 'Europe/Belgrade', [29378]],
  ['Singapura', 'Asia/Singapore', [29548]],
  ['Síria', 'Asia/Damascus', [29637]],
  ['Sri Lanka', 'Asia/Colombo', [30929]],
  ['Suécia', 'Europe/Stockholm', [29688]],
  ['Suíça', 'Europe/Zurich', [29700, 30864]],
  ['Suriname', 'America/Paramaribo', [30279]],
  ['Tailândia', 'Asia/Bangkok', [29343]],
  ['Taiwan', 'Asia/Taipei', [30570]],
  ['Tanzânia', 'Africa/Dar_es_Salaam', [38962]],
  ['Tchéquia', 'Europe/Prague', [30350]],
  ['Timor-Leste', 'Asia/Dili', [29645]],
  ['Togo', 'Africa/Lome', [29963]],
  ['Trinidad e Tobago', 'America/Port_of_Spain', [30325]],
  ['Tunísia', 'Africa/Tunis', [30708]],
  ['Turquia', 'Europe/Istanbul', [29297, 39306]],
  ['Ucrânia', 'Europe/Kiev', [29858]],
  ['Uruguai', 'America/Montevideo', [29319, 29521, 30147, 30430, 99244]],
  ['Venezuela', 'America/Caracas', [29505, 29564, 99279]],
  ['Vietnã', 'Asia/Ho_Chi_Minh', [29750]],
  ['Zâmbia', 'Africa/Lusaka', [99287]],
  ['Zimbábue', 'Africa/Harare', [29769]],
  ['África do Sul', 'Africa/Johannesburg', [29530, 30376]],
]

export const DIA_ELEICAO = '2026-10-25'
export const ABRE_H = 8
export const FECHA_H = 17
// o TSE divulga a apuração a partir das 17h de Brasília (20h UTC) do dia da eleição
export const PUBLICACAO_TSE = Date.parse('2026-10-25T20:00:00Z')

// hora de parede num fuso: { dia: 'AAAA-MM-DD', h, min, ms } (ms = a hora local lida como se fosse UTC)
const FORMATADORES = new Map()
export function horaLocal(tz, agora = Date.now()) {
  try {
    let f = FORMATADORES.get(tz)
    if (!f) FORMATADORES.set(tz, (f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })))
    const p = Object.fromEntries(f.formatToParts(new Date(agora)).map((x) => [x.type, x.value]))
    return { dia: `${p.year}-${p.month}-${p.day}`, h: Number(p.hour), min: Number(p.minute), ms: Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)) }
  } catch {
    return null
  }
}

// fase da votação num fuso: 'antes' (ainda não abriu), 'votando' (8h às 17h do dia 25) ou 'encerrada'
export function faseVotacao(tz, agora = Date.now()) {
  const t = horaLocal(tz, agora)
  if (!t) return 'antes'
  if (t.dia < DIA_ELEICAO) return 'antes'
  if (t.dia > DIA_ELEICAO || t.h >= FECHA_H) return 'encerrada'
  return t.h >= ABRE_H ? 'votando' : 'antes'
}

// instante (ms) em que são `hora` horas do dia da eleição naquele fuso (a diferença para UTC vem da hora local de agora;
// uma segunda passada corrige mudança de horário de verão no meio do caminho)
export function instante(tz, hora, agora = Date.now()) {
  const alvoLocal = Date.UTC(...DIA_ELEICAO.split('-').map((x, i) => (i === 1 ? Number(x) - 1 : Number(x))), hora, 0)
  let t = agora
  for (let i = 0; i < 2; i++) {
    const l = horaLocal(tz, t)
    if (!l) return null
    t += alvoLocal - l.ms
  }
  return t
}
