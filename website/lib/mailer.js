// Sends the sign-in code by email through Resend (https://resend.com), which needs RESEND_API_KEY and a sending
// address on a domain verified there (MAIL_FROM, e.g. "Scorpion <login@scorpionai.tech>").

export const mailConfigured = () => Boolean(process.env.RESEND_API_KEY);

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export async function sendSignInCode(to, code) {
  const base = process.env.RESEND_API_BASE || 'https://api.resend.com';
  const from = process.env.MAIL_FROM || 'Scorpion <login@scorpionai.tech>';
  const text = `Your Scorpion sign-in code is ${code}\n\nIt works for 10 minutes. If you didn't ask for it, you can ignore this email: nobody can see your downloads without it.`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#1a1405">
<p style="font-size:15px">Your Scorpion sign-in code:</p>
<p style="font-size:34px;font-weight:700;letter-spacing:8px;margin:12px 0">${esc(code)}</p>
<p style="font-size:13px;color:#555">It works for 10 minutes. If you didn't ask for it, you can ignore this email: nobody can see your downloads without it.</p></div>`;
  const res = await fetch(`${base}/emails`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject: `Your Scorpion sign-in code: ${code}`, text, html }),
  });
  return res.ok;
}
