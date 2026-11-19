// SPDX-License-Identifier: AGPL-3.0-or-later
// The "Menu" button of the site header on narrow screens. Without this script the links simply wrap under the logo.
(function () {
  document.documentElement.classList.add('nav-js');
  document.addEventListener('DOMContentLoaded', function () {
    var button = document.querySelector('.menu-btn');
    var nav = document.getElementById('site-nav');
    if (!button || !nav) return;
    function set(open) {
      nav.classList.toggle('open', open);
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
      button.textContent = open ? 'Close' : 'Menu';
    }
    button.addEventListener('click', function () {
      set(!nav.classList.contains('open'));
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && nav.classList.contains('open')) {
        set(false);
        button.focus();
      }
    });
  });
})();
