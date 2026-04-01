/* ============================================================
   Reusable Settings Panel Component
   Creates a gear button (top-right) and a dropdown panel with
   configurable buttons, toggles, and dividers.

   Usage:
     SettingsPanel.init({
       alwaysVisible: false,          // show gear button immediately?
       panelLabel: 'Settings',        // aria-label for the panel
       sections: [
         { type: 'buttons', items: [
             { id: 'restart', label: '↻ Restart', onClick: fn },
             { id: 'pause',   label: '⏸ Pause',   onClick: fn },
         ]},
         { type: 'divider' },
         { type: 'toggle', id: 'gaze-dot', label: 'Gaze dot', initial: true, onChange: fn(on) },
         { type: 'toggle', id: 'camera',   label: 'Camera',   initial: false, onChange: fn(on) },
       ],
     });

   API:
     show()                 — display the gear button
     hide()                 — hide gear button + close panel
     getState(id)           — get toggle boolean
     setState(id, bool)     — set toggle state (visual + internal, no callback)
     getButtonEl(id)        — get a button DOM element by section id
     isOpen()               — panel currently open?
   ============================================================ */
'use strict';

var SettingsPanel = (function () {

  var _gearBtn = null;
  var _panel   = null;
  var _isOpen  = false;
  var _toggles = {};   // id → { btn, state, onChange }
  var _buttons = {};   // id → btn element
  var _config  = {};

  var GEAR_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="3"/>' +
    '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06' +
    'a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 ' +
    '1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06' +
    'A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65' +
    ' 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65' +
    ' 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0' +
    ' 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65' +
    ' 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0' +
    '-1.51 1z"/></svg>';

  // ── internal helpers ──────────────────────────────────────────

  function _togglePanel() {
    _isOpen = !_isOpen;
    _panel.hidden = !_isOpen;
    _gearBtn.setAttribute('aria-expanded', String(_isOpen));
  }

  function _buildGearBtn() {
    var btn = document.createElement('button');
    btn.className = 'gear-btn' + (_config.alwaysVisible ? ' visible' : '');
    btn.setAttribute('aria-label', 'Settings');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = GEAR_SVG;
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      _togglePanel();
    });
    return btn;
  }

  function _buildPanel() {
    var panel = document.createElement('div');
    panel.className = 'settings-panel';
    panel.hidden = true;
    panel.setAttribute('aria-label', _config.panelLabel || 'Settings');

    var sections = _config.sections || [];
    sections.forEach(function (sec) {
      if (sec.type === 'divider') {
        var d = document.createElement('div');
        d.className = 'sp-divider';
        panel.appendChild(d);

      } else if (sec.type === 'buttons') {
        var wrap = document.createElement('div');
        wrap.className = 'sp-section';
        (sec.items || []).forEach(function (item) {
          var b = document.createElement('button');
          b.className = 'btn btn-sm sp-full-btn';
          b.innerHTML = item.label;
          if (item.onClick) b.addEventListener('click', item.onClick);
          if (item.id) _buttons[item.id] = b;
          wrap.appendChild(b);
        });
        panel.appendChild(wrap);

      } else if (sec.type === 'toggle') {
        var row = document.createElement('div');
        row.className = 'sp-row';

        var span = document.createElement('span');
        span.textContent = sec.label;
        row.appendChild(span);

        var on = !!sec.initial;
        var tb = document.createElement('button');
        tb.className = 'toggle-btn' + (on ? ' on' : '');
        tb.setAttribute('role', 'switch');
        tb.setAttribute('aria-checked', String(on));
        tb.setAttribute('aria-label', 'Toggle ' + sec.label.toLowerCase());

        _toggles[sec.id] = { btn: tb, state: on, onChange: sec.onChange || null };

        (function (id) {
          tb.addEventListener('click', function () {
            var t = _toggles[id];
            t.state = !t.state;
            t.btn.classList.toggle('on', t.state);
            t.btn.setAttribute('aria-checked', String(t.state));
            if (t.onChange) t.onChange(t.state);
          });
        })(sec.id);

        row.appendChild(tb);
        panel.appendChild(row);
      }
    });

    return panel;
  }

  // ── public API ────────────────────────────────────────────────

  function init(options) {
    _config  = options || {};
    _toggles = {};
    _buttons = {};
    _isOpen  = false;

    // Remove previous instance if re-initialised
    if (_gearBtn && _gearBtn.parentNode) _gearBtn.parentNode.removeChild(_gearBtn);
    if (_panel   && _panel.parentNode)   _panel.parentNode.removeChild(_panel);

    _gearBtn = _buildGearBtn();
    _panel   = _buildPanel();

    document.body.appendChild(_gearBtn);
    document.body.appendChild(_panel);

    // Close on outside click
    document.addEventListener('click', function (e) {
      if (_isOpen && !_panel.contains(e.target) && e.target !== _gearBtn) {
        _togglePanel();
      }
    });
  }

  function show() {
    if (_gearBtn) _gearBtn.classList.add('visible');
  }

  function hide() {
    if (_gearBtn) _gearBtn.classList.remove('visible');
    if (_isOpen) _togglePanel();
  }

  function getState(id) {
    return _toggles[id] ? _toggles[id].state : undefined;
  }

  function setState(id, val) {
    var t = _toggles[id];
    if (!t) return;
    t.state = !!val;
    t.btn.classList.toggle('on', t.state);
    t.btn.setAttribute('aria-checked', String(t.state));
  }

  function getButtonEl(id) {
    return _buttons[id] || null;
  }

  function isOpen() {
    return _isOpen;
  }

  return {
    init:        init,
    show:        show,
    hide:        hide,
    getState:    getState,
    setState:    setState,
    getButtonEl: getButtonEl,
    isOpen:      isOpen,
  };

})();
