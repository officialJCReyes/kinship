// SPDX-License-Identifier: AGPL-3.0-or-later
(function () {
  var tabs = document.querySelectorAll('.vtab');
  var panels = document.querySelectorAll('[data-p]');
  var soon = document.getElementById('vsoon');
  tabs.forEach(function (b) {
    b.addEventListener('click', function () {
      tabs.forEach(function (x) { x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
      panels.forEach(function (x) { x.hidden = x.getAttribute('data-p') !== b.dataset.v; });
      soon.hidden = b.dataset.v === 'tree';
    });
  });
})();
