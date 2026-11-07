const msg = document.getElementById('msg');
const next = (() => {
  const n = new URLSearchParams(location.search).get('next') || '/board/';
  return n.startsWith('/') && !n.startsWith('//') ? n : '/board/';
})();

async function onCredential({ credential }) {
  msg.textContent = '';
  const res = await fetch('/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  });
  if (res.ok) location.replace(next);
  else msg.textContent = (await res.json().catch(() => ({}))).error || 'Sign-in failed.';
}

const { clientId } = await (await fetch('/auth/config')).json();
if (!clientId) {
  msg.textContent = 'Sign-in is not configured yet.';
} else {
  await new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src: 'https://accounts.google.com/gsi/client', async: true });
    s.onload = resolve; s.onerror = () => reject(new Error('Could not load Google sign-in.'));
    document.head.append(s);
  }).catch((e) => { msg.textContent = e.message; throw e; });
  google.accounts.id.initialize({ client_id: clientId, callback: onCredential, ux_mode: 'popup' });
  google.accounts.id.renderButton(document.getElementById('gsi'), { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with' });
}
