const boardView = document.getElementById('boardView');
const emailView = document.getElementById('emailView');

function show(view) {
  boardView.hidden = view !== 'board';
  emailView.hidden = view !== 'email';
  (view === 'email' ? document.getElementById('em') : document.getElementById('pw')).focus();
}
document.getElementById('toEmail').addEventListener('click', () => show('email'));
document.getElementById('toBoard').addEventListener('click', () => show('board'));

// Both forms post to the server and, on success, land on the app.
function wire({ form, err, go, path, body, reset }) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    go.disabled = true;
    go.textContent = 'Signing in…';
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'aimsir' },
        body: JSON.stringify(body()),
      });
      if (res.ok) {
        location.replace('/');
        return;
      }
      const data = await res.json().catch(() => ({}));
      err.textContent = data.error || 'Sign-in failed. Please try again.';
    } catch {
      err.textContent = 'Could not reach the server. Check your connection and try again.';
    }
    err.hidden = false;
    reset();
    go.disabled = false;
    go.textContent = 'Sign in';
  });
}

const form = document.getElementById('form');
wire({
  form, err: document.getElementById('err'), go: document.getElementById('go'), path: '/api/login',
  body: () => ({ password: form.password.value }),
  reset: () => { form.password.value = ''; form.password.focus(); },
});

const emailForm = document.getElementById('emailForm');
wire({
  form: emailForm, err: document.getElementById('emailErr'), go: document.getElementById('emailGo'), path: '/api/login-email',
  body: () => ({ email: emailForm.email.value, password: emailForm.password.value }),
  reset: () => { emailForm.password.value = ''; emailForm.password.focus(); },
});
