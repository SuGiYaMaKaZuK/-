(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var compact = window.matchMedia('(max-width: 880px)');
  var editor = $('editor-dialog'), tabs = $('editor-panes'), extra = $('editor-more');
  var buttons = Array.from(tabs.querySelectorAll('[role=tab]'));
  var selected = 'pane-media';

  function show(id, focusTab) {
    selected = id;
    buttons.forEach(function (button) {
      var pane = $(button.getAttribute('aria-controls')), active = pane.id === selected;
      pane.hidden = compact.matches && !active;
      if (compact.matches) {
        pane.setAttribute('role', 'tabpanel');
        pane.setAttribute('aria-labelledby', button.id);
      } else {
        pane.removeAttribute('role');
        pane.removeAttribute('aria-labelledby');
      }
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      if (focusTab && compact.matches && active) button.focus();
    });
    if (editor.open && !$('pane-preview').hidden) requestAnimationFrame(function () {
      window.CardPanel.fit(); window.CardPanel.draw();
    });
  }
  function resize() {
    var focused = document.activeElement, pane = focused && focused.closest('#pane-media,#pane-preview,#pane-settings');
    var inExtra = extra.contains(focused), inTabs = tabs.contains(focused);
    tabs.hidden = !compact.matches;
    extra.open = !compact.matches;
    show(pane ? pane.id : selected);
    if (editor.open && compact.matches && inExtra) extra.querySelector('summary').focus();
    if (editor.open && !compact.matches && inTabs) $('editor-title').focus();
  }
  tabs.addEventListener('click', function (event) {
    var button = event.target.closest('[role=tab]');
    if (button) show(button.getAttribute('aria-controls'), true);
  });
  tabs.addEventListener('keydown', function (event) {
    var index = buttons.indexOf(event.target);
    if (index < 0) return;
    if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = buttons.length - 1;
    else if (event.key === 'ArrowRight') index = (index + 1) % buttons.length;
    else if (event.key === 'ArrowLeft') index = (index + buttons.length - 1) % buttons.length;
    else return;
    event.preventDefault(); show(buttons[index].getAttribute('aria-controls'), true);
  });
  function closeExtras(event) {
    if (compact.matches && extra.open && !extra.contains(event.target)) extra.open = false;
  }
  editor.addEventListener('pointerdown', closeExtras);
  editor.addEventListener('focusin', closeExtras);
  extra.addEventListener('click', function (event) {
    if (!compact.matches || !event.target.closest('button')) return;
    extra.open = false;
    if (extra.contains(document.activeElement)) extra.querySelector('summary').focus();
  });
  editor.addEventListener('cancel', function (event) {
    if (compact.matches && extra.open) {
      event.preventDefault(); event.stopImmediatePropagation(); extra.open = false; extra.querySelector('summary').focus();
    }
  }, true);
  window.addEventListener('cardreveal:editor-opened', function () {
    extra.open = !compact.matches;
    var project = window.CardPanel.getProject();
    var count = project.mode === 'highlight' ? 1 : project.mode === 'trapezoid' ? 3 : project.cards.length;
    var hasSource = project.cards.slice(0, count).some(function (card) { return !!card.mediaPath; });
    show(hasSource ? 'pane-preview' : 'pane-media');
    buttons.forEach(function (button) { $(button.getAttribute('aria-controls')).scrollTop = 0; });
  });
  $('edit-polygon').addEventListener('click', function () {
    if (compact.matches && this.getAttribute('aria-pressed') === 'true') show('pane-preview', true);
  });
  window.addEventListener('cardreveal:busy', function (event) {
    if (compact.matches && editor.open && event.detail.busy) {
      extra.open = false; show('pane-settings');
      $('cancel-render').scrollIntoView({ block: 'nearest' });
    }
  });
  compact.addEventListener('change', resize);
  resize();
}());
