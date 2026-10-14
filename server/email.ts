// Envio de e-mail pela API do Resend (https://resend.com), sem SDK. Sem RESEND_API_KEY (desenvolvimento),
// o e-mail não sai: o conteúdo vai para o console, com o link, para testar a recuperação de senha.
export type Email = { para: string; assunto: string; html: string; texto: string }
type Enviador = (e: Email) => Promise<{ ok: boolean; simulado?: boolean; id?: string }>

export const temEmail = () => !!process.env.RESEND_API_KEY
const remetente = () => process.env.EMAIL_DE || 'Apuração SC <onboarding@resend.dev>'

let enviador: Enviador = async (e) => {
  if (!temEmail()) {
    console.log(`[e-mail simulado] para: ${e.para} · assunto: ${e.assunto}\n${e.texto}`)
    return { ok: true, simulado: true }
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: remetente(), to: [e.para], subject: e.assunto, html: e.html, text: e.texto }),
  })
  if (!r.ok) {
    console.error('Resend', r.status, await r.text().catch(() => ''))
    return { ok: false }
  }
  const j = (await r.json().catch(() => ({}))) as { id?: string }
  return { ok: true, id: j.id }
}

export const enviarEmail = (e: Email) => enviador(e)
// testes: captura os e-mails em vez de enviar
export const definirEnvioEmail = (fn: Enviador) => (enviador = fn)

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] as string)

// modelo simples com botão
export function modeloEmail({ titulo, texto, botao, link, rodape }: { titulo: string; texto: string; botao?: string; link?: string; rodape?: string }) {
  const html = `<div style="font-family:Inter,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#17201b">
    <h2 style="margin:0 0 12px;font-size:20px">${esc(titulo)}</h2>
    <p style="font-size:15px;line-height:1.5">${esc(texto)}</p>
    ${botao && link ? `<p style="margin:20px 0"><a href="${esc(link)}" style="background:#0b7a45;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700;display:inline-block">${esc(botao)}</a></p><p style="font-size:12px;color:#5f6b65">Se o botão não abrir, copie este endereço: ${esc(link)}</p>` : ''}
    <p style="font-size:12px;color:#5f6b65;margin-top:24px">${esc(rodape || 'Apuração SC · dados oficiais do TSE · maiconcombat.com.br')}</p>
  </div>`
  const txt = `${titulo}\n\n${texto}${link ? `\n\n${botao || 'Abrir'}: ${link}` : ''}\n\n${rodape || 'Apuração SC'}`
  return { html, texto: txt }
}
