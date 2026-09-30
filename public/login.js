const form = document.getElementById('form');
const err = document.getElementById('err');
const go = document.getElementById('go');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.hidden = true;
  go.disabled = true;
  go.textContent = 'Signing in…';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'aimsir' },
      body: JSON.stringify({ password: form.password.value }),
    });
    if (res.ok) {
      location.replace('/');
      return;
    }
    const body = await res.json().catch(() => ({}));
    err.textContent = body.error || 'Sign-in failed. Please try again.';
  } catch {
    err.textContent = 'Could not reach the server. Check your connection and try again.';
  }
  err.hidden = false;
  form.password.value = '';
  form.password.focus();
  go.disabled = false;
  go.textContent = 'Sign in';
});
