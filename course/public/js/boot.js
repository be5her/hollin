// Runs before the first paint: the language (and its direction) and the theme, from what the reader
// chose last time, else from the browser. app.js reads the same keys.
(function () {
  var root = document.documentElement;
  var lang = null;
  var theme = null;
  try {
    lang = localStorage.getItem('hollin-course.lang');
    theme = localStorage.getItem('hollin-course.theme');
  } catch (e) {
    // Storage can be blocked: the defaults below still apply.
  }
  var asked = new URLSearchParams(location.search).get('lang');
  if (asked === 'ar' || asked === 'en') lang = asked;
  if (lang !== 'ar' && lang !== 'en') lang = /^ar\b/i.test(navigator.language || '') ? 'ar' : 'en';
  root.lang = lang;
  root.dir = lang === 'ar' ? 'rtl' : 'ltr';
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
})();
