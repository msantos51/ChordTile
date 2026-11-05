// Recebe o formulário de contacto (/contact): valida, limita abusos, guarda a mensagem em
// contact_messages e, se RESEND_API_KEY e CONTACT_TO estiverem definidos, envia-a por email
// (com "Responder" a ir direto para quem escreveu). Público: não precisa de sessão.
// A quem escreve não é enviado nenhum email automático (evita que o formulário sirva para enviar
// emails a terceiros).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const TO = Deno.env.get('CONTACT_TO') ?? '';
const FROM = Deno.env.get('CONTACT_FROM') ?? 'ChordTile <no-reply@mail.chordtile.com>';
const TOPICS: Record<string, string> = { support: 'Help with the site', billing: 'Premium and payments', privacy: 'Privacy and my data', feedback: 'Ideas and feedback', other: 'Other' };
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;
const PER_HOUR = 3, PER_DAY_ALL = 200;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const clean = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid request' }, 400); }

  // Campo escondido (só robôs o preenchem): finge que correu bem e não guarda nada
  if (clean(body.website, 200)) return json({ sent: true });

  const name = clean(body.name, 80).replace(/\s+/g, ' ');
  const email = clean(body.email, 254).toLowerCase();
  const topic = clean(body.topic, 20);
  const message = clean(body.message, 4000);
  if (!name) return json({ error: 'Please write your name.' }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: 'Please check your email address.' }, 400);
  if (!(topic in TOPICS)) return json({ error: 'Please choose a topic.' }, 400);
  if (message.length < 10) return json({ error: 'Please write a little more (at least 10 characters).' }, 400);

  // Quem escreve com sessão iniciada fica associado à conta (ajuda a responder sobre pagamentos)
  let userId: string | null = null;
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (jwt && jwt.split('.').length === 3) {
    const { data } = await admin.auth.getUser(jwt);
    userId = data.user?.id ?? null;
  }

  // Limites: 3 mensagens por hora por IP ou por email; 200 por dia no total
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const ipHash = await sha256('chordtile-contact:' + ip);
  const hourAgo = new Date(Date.now() - 3600_000).toISOString(), dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const [byIp, byEmail, all] = await Promise.all([
    admin.from('contact_messages').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', hourAgo),
    admin.from('contact_messages').select('id', { count: 'exact', head: true }).eq('email', email).gte('created_at', hourAgo),
    admin.from('contact_messages').select('id', { count: 'exact', head: true }).gte('created_at', dayAgo),
  ]);
  if ((byIp.count ?? 0) >= PER_HOUR || (byEmail.count ?? 0) >= PER_HOUR) return json({ error: 'You have sent several messages in a short time. Please try again in an hour.' }, 429);
  if ((all.count ?? 0) >= PER_DAY_ALL) return json({ error: 'We are receiving too many messages right now. Please try again tomorrow.' }, 429);

  const { data: row, error } = await admin.from('contact_messages')
    .insert({ name, email, topic, message, user_id: userId, ip_hash: ipHash }).select('id').single();
  if (error || !row) { console.error('contact insert', error); return json({ error: 'Could not send the message. Please try again.' }, 500); }

  if (RESEND_KEY && TO) {
    const html = `<p><strong>${esc(TOPICS[topic])}</strong> · #${row.id}</p>
<p>From: ${esc(name)} &lt;${esc(email)}&gt;${userId ? ' · has an account' : ''}</p>
<hr><p style="white-space:pre-wrap">${esc(message)}</p>`;
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': 'contact-' + row.id },
      body: JSON.stringify({ from: FROM, to: [TO], reply_to: email, subject: `[ChordTile] ${TOPICS[topic]} — ${name}`, html, text: `${TOPICS[topic]} · #${row.id}\nFrom: ${name} <${email}>\n\n${message}` }),
    });
    if (r.ok) await admin.from('contact_messages').update({ emailed: true }).eq('id', row.id);
    else console.error('contact email', r.status, await r.text());
  }
  return json({ sent: true });
});
