// SPDX-License-Identifier: AGPL-3.0-or-later
(function () {
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.vtab'));
  var panels = document.querySelectorAll('[data-p]');
  if (!tabs.length) return;
  var current = 0;
  var stopped = false;
  var paused = false;

  function show(i) {
    current = i;
    var b = tabs[i];
    tabs.forEach(function (x) { x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
    panels.forEach(function (x) { x.hidden = x.getAttribute('data-p') !== b.dataset.v; });
  }

  // A visitor who clicks a tab takes over: the automatic tour stops for good.
  tabs.forEach(function (b, i) {
    b.addEventListener('click', function () { stopped = true; show(i); });
  });

  // Otherwise the four views take turns every 2 seconds. The tour waits while the pointer or keyboard focus is on the
  // illustration, while the page is in a background tab, and does not start at all for people who ask for less motion.
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var box = tabs[0].parentNode.parentNode;
  box.addEventListener('mouseenter', function () { paused = true; });
  box.addEventListener('mouseleave', function () { paused = false; });
  box.addEventListener('focusin', function () { paused = true; });
  box.addEventListener('focusout', function () { paused = false; });
  setInterval(function () {
    if (stopped || paused || document.hidden) return;
    show((current + 1) % tabs.length);
  }, 2000);
})();
