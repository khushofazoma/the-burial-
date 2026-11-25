(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  const next = params.get('next');
  // only same-site paths
  if (next && next.startsWith('/') && !next.startsWith('//')) document.getElementById('gateNext').value = next;
  const err = params.get('error');
  const messages = {
    wrong: 'That is not the password.',
    limit: 'Too many attempts. Try again in 15 minutes.',
  };
  if (err) document.getElementById('gateError').textContent = messages[err] || 'Something went wrong.';
})();
