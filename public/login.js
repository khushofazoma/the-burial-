(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const messages = {
    domain: 'That account is not from Azoma or Ecomtent. Sign in with your work Google account.',
    cancelled: 'Sign-in was cancelled.',
    state: 'Your sign-in expired. Please try again.',
    google: 'Google sign-in failed. Please try again.',
    config: 'Google sign-in is not set up on this server yet.',
  };
  const err = params.get('error');
  if (err) document.getElementById('gateError').textContent = messages[err] || 'Sign-in failed.';

  // Local development: the server redirects here with ?dev=1 instead of going to Google.
  if (params.get('dev') === '1') {
    document.getElementById('devLogin').hidden = false;
    document.getElementById('googleBtn').hidden = true;
  }
})();
