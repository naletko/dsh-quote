/**
 * Quote — the browser half of dsh-quote.
 *
 * DSH client plugins are plain scripts, not ES modules: this file registers
 * itself with the browser module loader and never imports anything directly.
 * The component it registers into `conversation.input.activity` is invisible in
 * the toolbar; its whole job is to watch text selection inside the conversation
 * transcript and float one small button beside it. Everything the user sees
 * except that button (the plugin page's settings card) is registered into the
 * keyed `plugins.bundle.config` and `plugins.row.config` slots.
 */
window.__ModuleLoader__.load({
  id: 'dsh-quote',
  factory(require) {
    const React = require('react');
    const { createElement: h, useState, useEffect, useRef, useCallback, useMemo } = React;
    let reactDom = null;
    try {
      reactDom = require('react-dom');
    } catch (error) {
      reactDom = null;
    }

    /** Where the settings card caches the host's answer for the next page load. */
    const CONFIG_STORAGE_KEY = 'dsh_quote_config';

    /** The host route that owns persistence; `$DSH_HOME/dsh-quote-config.json`. */
    const CONFIG_ENDPOINT = '/api/dsh-quote/config';

    /** The hotkey used when neither the file nor the settings card names one. */
    const FALLBACK_HOTKEY = 'Mod+Shift+.';

    /** Space kept between the selection and the button, and at the viewport edges. */
    const VIEWPORT_MARGIN = 8;

    /** Vertical gap between the selection and the button. */
    const ANCHOR_GAP = 6;

    /** Selections shorter than this are almost always an accidental drag. */
    const MIN_SELECTION_LENGTH = 2;

    /** Longest hotkey expression the field accepts; mirrors the host's limit. */
    const MAX_HOTKEY_LENGTH = 48;

    /** Translation dictionaries. `ru` is chosen for a `ru*` document language. */
    const DICTIONARIES = {
      en: {
        copy: 'Copy',
        quote: 'Quote',
        quoteHint: 'Quote the selection ({hotkey})',
        summary: 'Enabled, attribution, length limit and hotkey',
        title: 'Quote',
        intro: 'Select text in the conversation and quote it into the composer. The draft you already typed is never replaced — the quote is appended to it after a blank line.',
        enabled: 'Enable quoting',
        attribution: 'Add an attribution line',
        attributionHint: 'Appends one closing quote line, for example “{text}”.',
        attributionText: '— quote',
        maxLength: 'Maximum quote length',
        maxLengthHint: 'Characters kept from the selection ({min}–{max}). Longer selections are trimmed.',
        hotkey: 'Keyboard shortcut',
        hotkeyHint: 'Click the field and press the combination you want. Requires at least one modifier.',
        hotkeyPlaceholder: 'Not set',
        record: 'Record',
        recording: 'Press the keys…',
        restore: 'Restore default',
        reset: 'Reset defaults',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved',
        reload: 'Reload from disk',
        saveFailed: 'Could not save: {error}',
        loadFailed: 'Using the defaults — the saved settings could not be read.',
        modifierRequired: 'Include Ctrl, Cmd, Alt or Shift.',
        preview: 'What lands in the composer',
        updates: 'Updates',
        updatesCurrent: 'Installed',
        updatesLatest: 'On GitHub',
        updatesCheck: 'Check',
        updatesApply: 'Update',
        updatesAvailable: 'An update is available',
        updatesRunning: 'Installing…',
        updatesDone: 'The update has been downloaded',
        updatesDoneHint: 'Reload the page; if the version above has not changed, restart the application.',
        updatesFailed: 'The update failed',
        updatesUpToDate: 'The latest version is installed',
        updatesManual: 'This deployment has no plugin manager — update from Plugins → Add plugin:',
        updatesNotes: "What's new",
        updatesReload: 'Reload the page',
        updatesUnavailable: 'The update check could not reach GitHub: {error}'
      },
      ru: {
        copy: 'Копировать',
        quote: 'Цитировать',
        quoteHint: 'Цитировать выделенное ({hotkey})',
        summary: 'Включение, атрибуция, лимит длины и горячая клавиша',
        title: 'Цитирование',
        intro: 'Выделите текст в переписке и вставьте его в поле ввода цитатой. Уже набранный черновик не затирается — цитата добавляется к нему после пустой строки.',
        enabled: 'Включить цитирование',
        attribution: 'Добавлять строку-атрибуцию',
        attributionHint: 'Добавляет одну закрывающую строку цитаты, например «{text}».',
        attributionText: '— цитата',
        maxLength: 'Максимальная длина цитаты',
        maxLengthHint: 'Сколько символов брать из выделения ({min}–{max}). Более длинное выделение обрезается.',
        hotkey: 'Горячая клавиша',
        hotkeyHint: 'Нажмите на поле и введите нужное сочетание. Нужен хотя бы один модификатор.',
        hotkeyPlaceholder: 'Не задана',
        record: 'Записать',
        recording: 'Нажмите клавиши…',
        restore: 'Вернуть по умолчанию',
        reset: 'Сбросить настройки',
        save: 'Сохранить',
        saving: 'Сохранение…',
        saved: 'Сохранено',
        reload: 'Перечитать с диска',
        saveFailed: 'Не удалось сохранить: {error}',
        loadFailed: 'Использованы настройки по умолчанию — сохранённые прочитать не удалось.',
        modifierRequired: 'Добавьте Ctrl, Cmd, Alt или Shift.',
        preview: 'Что попадёт в поле ввода',
        updates: 'Обновления',
        updatesCurrent: 'Установлено',
        updatesLatest: 'На GitHub',
        updatesCheck: 'Проверить',
        updatesApply: 'Обновить',
        updatesAvailable: 'Доступно обновление',
        updatesRunning: 'Устанавливаю…',
        updatesDone: 'Обновление скачано',
        updatesDoneHint: 'Обновите страницу; если версия выше не изменилась — перезапустите приложение.',
        updatesFailed: 'Не удалось обновить',
        updatesUpToDate: 'Установлена последняя версия',
        updatesManual: 'В этой сборке нет менеджера плагинов — обновите через «Плагины → Добавить плагин»:',
        updatesNotes: 'Что нового',
        updatesReload: 'Обновить страницу',
        updatesUnavailable: 'Не удалось проверить обновления: {error}'
      }
    };

    /** The settings the client starts from when the host cannot be reached. */
    const DEFAULT_CONFIG = {
      enabled: true,
      attribution: false,
      maxLength: 4000,
      hotkey: FALLBACK_HOTKEY
    };

    // ── Locale ───────────────────────────────────────────────────────────────
    // Chosen once per page from the document language, per the product's own
    // convention: a `ru*` document gets Russian, everything else English.

    function detectLanguage() {
      try {
        const declared = String(document?.documentElement?.lang ?? '').trim().toLowerCase();
        if (declared !== '') return declared.startsWith('ru') ? 'ru' : 'en';
        const navigatorLanguage = String(window?.navigator?.language ?? '').trim().toLowerCase();
        return navigatorLanguage.startsWith('ru') ? 'ru' : 'en';
      } catch (error) {
        return 'en';
      }
    }

    const LANGUAGE = detectLanguage();
    const TEXT = DICTIONARIES[LANGUAGE] ?? DICTIONARIES.en;

    /** Look up one string and fill its `{name}` placeholders. */
    function message(key, values) {
      const template = TEXT[key] ?? DICTIONARIES.en[key] ?? key;
      if (values === undefined) return template;
      return template.replace(/\{(\w+)\}/gu, (match, name) => (
        values[name] === undefined ? match : String(values[name])
      ));
    }

    /**
     * Whether the plugin should replace the browser's context menu.
     *
     * Only while quoting is enabled *and* something is selected: the rest of the
     * page keeps its native menu, and an empty selection has nothing to quote.
     *
     * @param enabled - the plugin's own switch.
     * @param hasSelection - whether a non-empty transcript selection exists.
     * @returns true when the page should show its own Copy/Quote menu.
     */
    function shouldTakeOverContextMenu(enabled, hasSelection) {
      return enabled === true && hasSelection === true;
    }

    /** Whether the pointer/keyboard conventions of this machine are Apple's. */
    function isApplePlatform() {
      try {
        const platform = String(window?.navigator?.userAgentData?.platform ?? window?.navigator?.platform ?? '');
        if (/mac|iphone|ipad|ipod/iu.test(platform)) return true;
        return /mac os x/iu.test(String(window?.navigator?.userAgent ?? ''));
      } catch (error) {
        return false;
      }
    }

    const APPLE = isApplePlatform();

    // ── Quote formatting (pure) ──────────────────────────────────────────────
    // These functions hold every rule the plugin applies to text: trimming,
    // collapsing blank runs, the `> ` prefix, the attribution line and the
    // length limit. They are also exported through the test hook at the bottom
    // of the factory, so `test/quote-logic-check.mjs` exercises the very same
    // code the composer runs.

    /**
     * Fold a selection into the lines a block quote is built from: line endings
     * are normalized, the selection and every line are trimmed on the outside,
     * runs of blank lines collapse to one, and leading/trailing blanks vanish.
     * Indentation *inside* a line is preserved, so quoted code stays readable.
     */
    function normalizeSelectionText(raw) {
      if (typeof raw !== 'string' || raw === '') return [];
      const lines = raw
        .replace(/\r\n?/gu, '\n')
        .replace(/\u00a0/gu, ' ')
        .trim()
        .split('\n')
        .map((line) => line.replace(/[ \t]+$/u, ''));
      const collapsed = [];
      let previousBlank = true;
      for (const line of lines) {
        const blank = line.trim() === '';
        if (blank && previousBlank) continue;
        collapsed.push(blank ? '' : line);
        previousBlank = blank;
      }
      while (collapsed.length > 0 && collapsed[collapsed.length - 1] === '') collapsed.pop();
      const firstContent = collapsed.findIndex((line) => line !== '');
      if (firstContent === -1) return [];
      return collapsed.slice(firstContent);
    }

    /** Keep at most `maxLength` characters, never cutting a word in half twice. */
    function truncateText(text, maxLength) {
      const limit = Number.isFinite(maxLength) && maxLength > 0 ? maxLength : DEFAULT_CONFIG.maxLength;
      if (text.length <= limit) return { text, clipped: false };
      return { text: text.slice(0, limit).trimEnd(), clipped: true };
    }

    /** Turn one line into a block-quote line; a blank line stays an empty `>`. */
    function quoteLine(line) {
      return line.trim() === '' ? '>' : `> ${line}`;
    }

    /**
     * Build the exact markdown that gets inserted, in two steps: the selected
     * text is trimmed and bounded by `maxLength`, then every line is prefixed
     * and an optional attribution line closes the quote.
     *
     * @returns `{ text, clipped }` — `text` is empty when nothing quotable was
     *   selected, and `clipped` reports whether the length limit cut it short.
     */
    function buildQuoteText(raw, options) {
      const settings = options ?? {};
      const attributionEnabled = settings.attributionEnabled === true;
      const attribution = typeof settings.attribution === 'string' ? settings.attribution.trim() : '';
      const lines = normalizeSelectionText(raw);
      if (lines.length === 0) return { text: '', clipped: false };

      const bounded = truncateText(lines.join('\n'), settings.maxLength);
      const kept = normalizeSelectionText(bounded.text);
      if (kept.length === 0) return { text: '', clipped: bounded.clipped };

      if (attributionEnabled && attribution !== '') kept.push(attribution);
      return { text: kept.map(quoteLine).join('\n'), clipped: bounded.clipped };
    }

    /**
     * Insert `quote` into `draft` the way the specification asks: one blank line
     * between what was already typed and the quote, and no stray blank line when
     * the draft already ends with one — or is empty.
     */
    function buildAppendText(draft, quote) {
      if (typeof quote !== 'string' || quote === '') return typeof draft === 'string' ? draft : '';
      const base = typeof draft === 'string' ? draft : '';
      if (base === '') return quote;
      if (/\n[ \t]*\n[ \t]*$/u.test(base)) return `${base}${quote}`;
      if (base.endsWith('\n')) return `${base}\n${quote}`;
      return `${base}\n\n${quote}`;
    }

    // ── Hotkey (pure) ────────────────────────────────────────────────────────

    /**
     * Parse a hotkey expression into modifiers plus one key. `Mod` is the
     * portable spelling of Cmd on macOS and Ctrl elsewhere, which is how the
     * default binding stays correct on both platforms.
     */
    function parseHotkey(expression) {
      if (typeof expression !== 'string') return null;
      const trimmed = expression.trim();
      if (trimmed === '' || trimmed.length > MAX_HOTKEY_LENGTH) return null;
      const parts = trimmed.split('+').map((part) => part.trim()).filter((part) => part !== '');
      if (parts.length < 2) return null;
      const parsed = { ctrl: false, meta: false, shift: false, alt: false, key: '' };
      for (let index = 0; index < parts.length; index++) {
        const part = parts[index];
        const lower = part.toLowerCase();
        const last = index === parts.length - 1;
        if (lower === 'mod') {
          if (APPLE) parsed.meta = true;
          else parsed.ctrl = true;
        } else if (lower === 'ctrl' || lower === 'control') {
          parsed.ctrl = true;
        } else if (lower === 'cmd' || lower === 'command' || lower === 'meta') {
          parsed.meta = true;
        } else if (lower === 'shift') {
          parsed.shift = true;
        } else if (lower === 'alt' || lower === 'option') {
          parsed.alt = true;
        } else if (last === true) {
          parsed.key = lower;
        } else {
          return null;
        }
      }
      if (parsed.key === '') return null;
      return parsed;
    }

    /** Whether a keydown event is exactly the parsed chord. */
    function matchesHotkey(event, parsed) {
      if (parsed === null || event === null || event === undefined) return false;
      if (event.ctrlKey === true !== parsed.ctrl) return false;
      if (event.metaKey === true !== parsed.meta) return false;
      if (event.shiftKey === true !== parsed.shift) return false;
      if (event.altKey === true !== parsed.alt) return false;
      const key = String(event.key ?? '').toLowerCase();
      if (key === '') return false;
      if (key === parsed.key) return true;
      return parsed.key.length === 1 && event.code === `Key${parsed.key.toUpperCase()}`;
    }

    /** Present a chord with the symbols this platform's users expect. */
    function formatHotkeyLabel(expression) {
      const parsed = parseHotkey(expression);
      if (parsed === null) return String(expression ?? '');
      const order = ['ctrl', 'alt', 'shift', 'meta'];
      const names = APPLE
        ? { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' }
        : { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win' };
      const pieces = [];
      for (const name of order) if (parsed[name] === true) pieces.push(names[name]);
      pieces.push(parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key);
      return pieces.join(APPLE ? '' : '+');
    }

    /** Turn a live keydown into the portable expression the settings store. */
    function hotkeyFromEvent(event) {
      const parts = [];
      if (event.ctrlKey === true) parts.push(APPLE ? 'Ctrl' : 'Mod');
      if (event.metaKey === true) parts.push(APPLE ? 'Mod' : 'Meta');
      if (event.altKey === true) parts.push('Alt');
      if (event.shiftKey === true) parts.push('Shift');

      const code = String(event.code ?? '');
      const key = String(event.key ?? '');
      let main = '';
      if (/^Key[A-Z]$/u.test(code)) main = code.slice(3).toLowerCase();
      else if (/^Digit\d$/u.test(code)) main = code.slice(5);
      else if (/^Numpad\d$/u.test(code)) main = code.slice(6);
      else if (code.startsWith('Numpad')) main = code.slice(6).toLowerCase();
      else if (key === ' ' || code === 'Space') main = 'Space';
      else if (key.length === 1) main = key.toLowerCase();
      else if (key !== '') main = key;
      if (main === '') return null;
      if (parts.length === 0) return null;
      return [...parts, main].join('+');
    }

    // ── Settings ─────────────────────────────────────────────────────────────
    // The host owns the file; `localStorage` is only a cache so the composer
    // knows the user's settings on the very first paint. Writes go to both.

    /** Fold an untrusted object onto the defaults, dropping unknown shapes. */
    function normalizeConfig(raw) {
      const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      const maxLength = Number(source.maxLength);
      return {
        enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_CONFIG.enabled,
        attribution: typeof source.attribution === 'boolean' ? source.attribution : DEFAULT_CONFIG.attribution,
        maxLength: Number.isFinite(maxLength) && maxLength >= 200 && maxLength <= 20000
          ? Math.trunc(maxLength)
          : DEFAULT_CONFIG.maxLength,
        hotkey: parseHotkey(source.hotkey) !== null ? String(source.hotkey).trim() : DEFAULT_CONFIG.hotkey
      };
    }

    function loadSavedConfig() {
      try {
        const item = window?.localStorage?.getItem(CONFIG_STORAGE_KEY);
        if (item) return normalizeConfig(JSON.parse(item));
      } catch (error) {
        // A corrupt cache is not worth a console entry: the defaults are fine.
      }
      return { ...DEFAULT_CONFIG };
    }

    function cacheConfig(config) {
      try {
        window?.localStorage?.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
      } catch (error) {
        // Private-mode storage denials are expected and harmless.
      }
    }

    /** Read the settings from the host, falling back to the cached copy. */
    async function fetchHostConfig() {      const response = await fetch(CONFIG_ENDPOINT, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data === null || typeof data !== 'object' || data.ok !== true) {
        throw new Error('The host did not return a configuration');
      }
      return normalizeConfig(data.config);
    }

    /** Write the settings through the host, then refresh the local cache. */
    async function persistConfig(patch) {
      const response = await fetch(CONFIG_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(patch)
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || data === null || data.ok !== true) {
        throw new Error(data?.error ?? `HTTP ${response.status}`);
      }
      const config = normalizeConfig(data.config);
      cacheConfig(config);
      return config;
    }

    // ── Updates ──────────────────────────────────────────────────────────────
    // The plugin is installed from Git, so it asks its own repository whether the
    // branch has moved and hands the revision to the harness plugin manager. The
    // host owns both steps; this half only renders them.

    /** The update route the host registers beside the configuration route. */
    const UPDATE_ENDPOINT = '/api/dsh-quote/update';

    /** Ask the host what the branch holds and what is running here. */
    async function fetchUpdate(force) {
      const response = await fetch(`${UPDATE_ENDPOINT}${force ? '?force=1' : ''}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || data === null || data.ok !== true) {
        throw new Error(data?.error ?? `HTTP ${response.status}`);
      }
      return data;
    }

    /** Ask the host to install the revision it just reported. */
    async function startUpdate() {
      const response = await fetch(`${UPDATE_ENDPOINT}/apply`, {
        method: 'POST',
        headers: { Accept: 'application/json' }
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || data === null || data.ok !== true) {
        throw new Error(data?.error ?? `HTTP ${response.status}`);
      }
      return data;
    }

    /**
     * The updates block under the settings form: the version installed, the
     * version on the branch, what changed, and one button.
     */
    function QuoteUpdates() {
      const [info, setInfo] = useState(null);
      const [busy, setBusy] = useState(false);
      const [failed, setFailed] = useState('');

      const load = useCallback(async (force) => {
        try {
          setInfo(await fetchUpdate(force));
          setFailed('');
        } catch (error) {
          setFailed(error?.message ?? String(error));
        }
      }, []);

      useEffect(() => {
        void load(false);
      }, [load]);

      useEffect(() => {
        if (info?.progress?.status !== 'running') return undefined;
        const timer = setInterval(() => {
          void load(true);
        }, 2500);
        return () => clearInterval(timer);
      }, [info, load]);

      const running = info?.progress?.status === 'running';
      const start = async () => {
        setBusy(true);
        try {
          const body = await startUpdate();
          setInfo((current) => (current === null
            ? current
            : { ...current, progress: { status: 'running', spec: body.spec, at: Date.now() } }));
        } catch (error) {
          setFailed(error?.message ?? String(error));
        } finally {
          setBusy(false);
        }
      };

      return h('section', { className: 'dsh-quote-field' },
        h('h3', { className: 'dsh-quote-row-label' }, message('updates')),

        info === null
          ? h('p', { className: 'dsh-quote-field-hint' }, failed === '' ? '…' : message('updatesUnavailable', { error: failed }))
          : h('div', null,
            h('p', { className: 'dsh-quote-field-hint' },
              `${message('updatesCurrent')}: ${info.current} · ${message('updatesLatest')}: ${info.latest}${info.sha ? ` (${info.sha})` : ''}`),

            Array.isArray(info.notes) && info.notes.length > 0
              ? h('ul', { className: 'dsh-quote-field-hint' },
                info.notes.map((note) => h('li', { key: note.sha }, `${note.sha} · ${note.message}`)))
              : null,

            h('div', { className: 'dsh-quote-actions' },
              running
                ? h('span', { className: 'dsh-quote-status' }, message('updatesRunning'))
                : null,
              h('button', {
                type: 'button',
                className: 'dsh-quote-btn dsh-quote-action',
                disabled: running,
                onClick: () => void load(true)
              }, message('updatesCheck')),
              info.updateAvailable || running
                ? h('button', {
                  type: 'button',
                  className: 'dsh-quote-btn dsh-quote-action dsh-quote-action-primary',
                  disabled: running || busy || info.manager === false,
                  onClick: () => void start()
                }, `${message('updatesApply')} → ${info.latest}`)
                : null,
              !info.updateAvailable && !running
                ? h('span', { className: 'dsh-quote-status' }, message('updatesUpToDate'))
                : null),

            info.manager === false
              ? h('p', { className: 'dsh-quote-field-hint' }, `${message('updatesManual')} ${info.spec}`)
              : null,

            info.progress?.status === 'done'
              ? h('div', { className: 'dsh-quote-actions' },
                h('span', { className: 'dsh-quote-status' }, `${message('updatesDone')}. ${message('updatesDoneHint')}`),
                h('button', {
                  type: 'button',
                  className: 'dsh-quote-btn dsh-quote-action',
                  onClick: () => { try { window.location.reload(); } catch (error) { /* reload is best effort */ } }
                }, message('updatesReload')))
              : null,

            info.progress?.status === 'error'
              ? h('p', { className: 'dsh-quote-status dsh-quote-status-error' },
                `${message('updatesFailed')}: ${info.progress.error ?? ''}`)
              : null),

        failed !== '' && info !== null
          ? h('p', { className: 'dsh-quote-status dsh-quote-status-error' }, message('updatesUnavailable', { error: failed }))
          : null);
    }

    /**
     * One tiny store keeps the composer button and the settings card in step:
     * saving on the plugin page immediately changes what the composer does,
     * without a reload.
     */
    const configStore = {
      config: loadSavedConfig(),
      listeners: new Set(),
      publish(next) {
        this.config = normalizeConfig(next);
        cacheConfig(this.config);
        for (const listener of [...this.listeners]) {
          try {
            listener(this.config);
          } catch (error) {
            console.warn('[dsh-quote] settings listener failed', error);
          }
        }
      },
      subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      }
    };

    // ── Selection plumbing ───────────────────────────────────────────────────

    /** A text field, a textarea or any rich-text host, including descendants. */
    function isEditableNode(node) {
      if (node === null || node === undefined) return false;
      if (node.nodeType === 3) return isEditableNode(node.parentElement);
      if (node.nodeType !== 1) return false;
      const tag = String(node.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      if (node.isContentEditable === true) return true;
      const editable = node.getAttribute?.('contenteditable');
      return editable !== null && editable !== undefined && editable !== 'false';
    }

    /** Walk up the tree looking for an editable ancestor or the composer. */
    function isInsideEditable(node) {
      let current = node?.nodeType === 3 ? node.parentElement : node;
      while (current !== null && current !== undefined) {
        if (isEditableNode(current)) return true;
        if (current.getAttribute?.('data-composer-card') !== null
          && current.getAttribute?.('data-composer-card') !== undefined) return true;
        current = current.parentElement;
      }
      return false;
    }

    /** The composer's text, for the fallback path that appends to the draft. */
    function readDraftText() {
      try {
        const card = document.querySelector('[data-composer-card]');
        if (card === null) return '';
        const editor = card.querySelector('[data-lexical-editor="true"]')
          ?? card.querySelector('[contenteditable="true"]')
          ?? card.querySelector('textarea');
        if (editor === null) return '';
        if (typeof editor.value === 'string') return editor.value;
        const isBlock = (node) => node.nodeType === 1 && /^(DIV|P|LI|UL|OL|BLOCKQUOTE|PRE)$/u.test(String(node.tagName ?? ''));
        const collect = (node) => {
          if (node.nodeType === 3) return node.nodeValue ?? '';
          if (node.nodeType !== 1) return '';
          if (String(node.tagName ?? '').toLowerCase() === 'br') return '\n';
          const inner = [...(node.childNodes ?? [])].map(collect).join('');
          return isBlock(node) && node.nextSibling !== null ? `${inner}\n` : inner;
        };
        return [...(editor.childNodes ?? [])].map(collect).join('').replace(/\n$/u, '');
      } catch (error) {
        return '';
      }
    }

    /**
     * Read the current selection, but only when it is worth quoting: it has to
     * be expanded, long enough, and outside every editable surface (otherwise
     * quoting inside the composer would produce garbage).
     *
     * @returns `{ text, range, rect }` or `null`.
     */
    function readQuotedSelection() {
      try {
        const selection = window.getSelection?.();
        if (selection === null || selection === undefined || selection.isCollapsed === true) return null;
        if (selection.rangeCount === 0) return null;
        const range = selection.getRangeAt(0);
        const common = range.commonAncestorContainer;
        const element = common?.nodeType === 1 ? common : common?.parentElement;
        if (element === null || element === undefined || document.body?.contains(element) !== true) return null;
        if (isInsideEditable(element) || isInsideEditable(range.startContainer) || isInsideEditable(range.endContainer)) {
          return null;
        }
        const text = String(selection.toString() ?? '').trim();
        if (text.length < MIN_SELECTION_LENGTH) return null;
        const rect = range.getBoundingClientRect?.();
        return { text, range, rect: rect ?? null };
      } catch (error) {
        return null;
      }
    }

    /** Where the button wants to sit, clamped so it never leaves the viewport. */
    function computeQuotePosition(rect, size) {
      const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || 1024;
      const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 768;
      const width = Math.max(1, size?.width ?? 1);
      const height = Math.max(1, size?.height ?? 1);
      const maxTop = Math.max(VIEWPORT_MARGIN, viewportHeight - height - VIEWPORT_MARGIN);
      const bottom = rect?.bottom ?? 0;
      const top = rect?.top ?? 0;
      const left = rect?.left ?? 0;
      // Below the selection by default, above it when the bottom of the viewport
      // is too close. The chosen side is then clamped into the viewport, so a
      // selection at the very bottom edge can never push the button off screen.
      const below = bottom + ANCHOR_GAP;
      const flipped = below + height > viewportHeight - VIEWPORT_MARGIN;
      const preferred = flipped ? top - height - ANCHOR_GAP : below;
      const centered = left + ((rect?.width ?? 0) - width) / 2;
      const left_ = Math.min(
        Math.max(VIEWPORT_MARGIN, centered),
        Math.max(VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN)
      );
      return {
        top: Math.min(Math.max(VIEWPORT_MARGIN, preferred), maxTop),
        left: left_
      };
    }

    // ── Icons ────────────────────────────────────────────────────────────────

    /** The quote mark that sits on the floating button and the card's title. */
    function IconQuote(props) {
      const size = props?.size ?? 14;
      return h('svg', {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.9,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        focusable: 'false'
      },
        h('path', { d: 'M9 17.5c-2.3 0-3.6-1.7-3.6-3.8 0-2.6 1.8-5.2 4.6-6.9' }),
        h('path', { d: 'M17.4 17.5c-2.3 0-3.6-1.7-3.6-3.8 0-2.6 1.8-5.2 4.6-6.9' })
      );
    }

    // ── Styles ───────────────────────────────────────────────────────────────
    // Every colour is a DSH theme token with a readable fallback, so the button
    // and the card look native in the dark and the light theme alike.

    const STYLES = `
      .dsh-quote-anchor {
        position: fixed;
        top: 0;
        left: 0;
        width: 0;
        height: 0;
        margin: 0;
        padding: 0;
        border: 0;
        z-index: 2147483000;
        pointer-events: none;
      }
      .dsh-quote-layer {
        position: fixed;
        top: 0;
        left: 0;
        width: 0;
        height: 0;
        z-index: 2147483000;
        pointer-events: none;
      }
      .dsh-quote-menu {
        position: fixed;
        z-index: 2147483000;
        display: flex;
        flex-direction: column;
        min-width: 168px;
        padding: 5px;
        gap: 2px;
        pointer-events: auto;
        border-radius: 11px;
        border: 1px solid var(--dsw-alias-border-l3, rgba(255, 255, 255, 0.14));
        background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, #22252c));
        box-shadow: var(--dsw-elevation-prominent, 0 12px 32px rgba(0, 0, 0, 0.34));
        color: var(--dsw-alias-label-primary, #e9ecf1);
        font: inherit;
      }
      .dsh-quote-menu-item {
        display: block;
        width: 100%;
        text-align: left;
        padding: 7px 11px;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: 13px;
        cursor: pointer;
      }
      .dsh-quote-menu-item:hover,
      .dsh-quote-menu-item:focus-visible {
        background: var(--dsh-alias-interactive-bg-hover, rgba(255, 255, 255, 0.09));
        outline: none;
      }
      .dsh-quote-menu-item-accent {
        font-weight: 600;
        color: var(--dsw-alias-brand-primary, #5b8bf0);
      }
      .dsh-quote-btn {
        position: fixed;
        z-index: 2147483000;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 28px;
        padding: 0 10px;
        box-sizing: border-box;
        font: inherit;
        font-size: 12px;
        font-weight: 500;
        line-height: 1;
        white-space: nowrap;
        color: var(--dsw-alias-label-primary, #ececf1);
        background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-2, #2b2b30));
        border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.18));
        border-radius: var(--dsw-radius-md, 8px);
        box-shadow: var(--dsw-elevation-soft, 0 6px 20px rgba(0, 0, 0, 0.32));
        cursor: pointer;
        pointer-events: auto;
        -webkit-user-select: none;
        user-select: none;
        animation: dsh-quote-in 120ms ease-out;
        transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
      }
      .dsh-quote-btn:hover {
        background: var(--dsw-alias-bg-layer-3, rgba(255, 255, 255, 0.09));
        border-color: var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.26));
      }
      .dsh-quote-btn:active {
        background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.14));
      }
      .dsh-quote-btn:focus-visible {
        outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6);
        outline-offset: 2px;
      }
      .dsh-quote-btn svg {
        flex: none;
        color: var(--dsw-alias-label-secondary, #a9a9b0);
      }
      .dsh-quote-btn:hover svg {
        color: var(--dsw-alias-state-business-primary, #4176e6);
      }
      .dsh-quote-btn[data-clipped="true"] {
        color: var(--dsw-alias-state-warn-primary, #e6a23c);
      }
      @keyframes dsh-quote-in {
        from { opacity: 0; transform: translateY(2px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @media (prefers-reduced-motion: reduce) {
        .dsh-quote-btn { animation: none; transition: none; }
      }

      .dsh-quote-form {
        display: flex;
        flex-direction: column;
        gap: 14px;
        max-width: 460px;
        padding: 2px 0 6px;
      }
      .dsh-quote-title {
        display: flex;
        align-items: center;
        gap: 7px;
        font-size: 13px;
        font-weight: 600;
        color: var(--dsw-alias-label-primary, #ececf1);
      }
      .dsh-quote-title svg {
        color: var(--dsw-alias-label-secondary, #a9a9b0);
      }
      .dsh-quote-intro,
      .dsh-quote-field-hint {
        font-size: 11px;
        line-height: 1.55;
        color: var(--dsw-alias-label-tertiary, rgba(255, 255, 255, 0.42));
      }
      .dsh-quote-row {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
      }
      .dsh-quote-row input[type="checkbox"] {
        width: 14px;
        height: 14px;
        flex: none;
        accent-color: var(--dsw-alias-state-business-primary, #4176e6);
        cursor: pointer;
      }
      .dsh-quote-row-label {
        font-size: 12px;
        font-weight: 500;
        color: var(--dsw-alias-label-primary, #ececf1);
      }
      .dsh-quote-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .dsh-quote-field-label {
        font-size: 12px;
        font-weight: 500;
        color: var(--dsw-alias-label-secondary, #a9a9b0);
      }
      .dsh-quote-field-input {
        width: 100%;
        box-sizing: border-box;
        padding: 8px 10px;
        font: inherit;
        font-size: 13px;
        line-height: 1.4;
        color: var(--dsw-alias-label-primary, #ececf1);
        background: var(--dsw-alias-bg-layer-2, rgba(255, 255, 255, 0.05));
        border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.12));
        border-radius: var(--dsw-radius-md, 8px);
        outline: none;
        transition: border-color 120ms ease, box-shadow 120ms ease;
      }
      .dsh-quote-field-input::placeholder {
        color: var(--dsw-alias-label-tertiary, rgba(255, 255, 255, 0.3));
      }
      .dsh-quote-field-input:hover {
        border-color: var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.2));
      }
      .dsh-quote-field-input:focus {
        border-color: var(--dsw-alias-state-business-primary, #4176e6);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 18%, transparent);
      }
      .dsh-quote-input-short { max-width: 108px; }
      .dsh-quote-hotkey {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .dsh-quote-hotkey-field {
        flex: 1 1 auto;
        min-width: 0;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        text-align: center;
        cursor: pointer;
      }
      .dsh-quote-hotkey-field[data-recording="true"] {
        border-color: var(--dsw-alias-state-business-primary, #4176e6);
        color: var(--dsw-alias-state-business-primary, #4176e6);
      }
      .dsh-quote-preview {
        margin: 0;
        padding: 8px 10px;
        max-height: 120px;
        overflow: auto;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 11px;
        line-height: 1.5;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        color: var(--dsw-alias-label-secondary, #a9a9b0);
        background: var(--dsw-alias-bg-layer-2, rgba(255, 255, 255, 0.05));
        border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.12));
        border-radius: var(--dsw-radius-md, 8px);
      }
      .dsh-quote-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 2px;
      }
      .dsh-quote-action {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 30px;
        padding: 0 14px;
        font: inherit;
        font-size: 12px;
        font-weight: 500;
        border-radius: var(--dsw-radius-md, 8px);
        border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.18));
        background: transparent;
        color: var(--dsw-alias-label-primary, #ececf1);
        cursor: pointer;
        transition: background 120ms ease, filter 120ms ease, border-color 120ms ease;
      }
      .dsh-quote-action:hover {
        background: var(--dsw-alias-bg-layer-3, rgba(255, 255, 255, 0.08));
      }
      .dsh-quote-action:focus-visible {
        outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6);
        outline-offset: 2px;
      }
      .dsh-quote-action-primary {
        background: var(--dsw-alias-state-business-primary, #4176e6);
        border-color: var(--dsw-alias-state-business-primary, #4176e6);
        color: #ffffff;
      }
      .dsh-quote-action-primary:hover {
        filter: brightness(1.1);
        background: var(--dsw-alias-state-business-primary, #4176e6);
      }
      .dsh-quote-action-quiet {
        border-color: transparent;
        color: var(--dsw-alias-label-secondary, #a9a9b0);
      }
      .dsh-quote-link {
        align-self: flex-start;
        padding: 0;
        border: none;
        background: none;
        font: inherit;
        font-size: 11px;
        color: var(--dsw-alias-state-business-primary, #4176e6);
        cursor: pointer;
      }
      .dsh-quote-link:hover {
        text-decoration: underline;
      }
      .dsh-quote-status {
        font-size: 11px;
        color: var(--dsw-alias-label-tertiary, rgba(255, 255, 255, 0.42));
      }
      .dsh-quote-status-error {
        color: var(--dsw-alias-state-error-primary, #f56c6c);
      }
      @media (prefers-reduced-motion: reduce) {
        .dsh-quote-field-input,
        .dsh-quote-action { transition: none; }
      }
    `;

    /** Mount the stylesheet once and take it away with the last component. */
    function usePluginStyles(enabled) {
      useEffect(() => {
        if (enabled !== true || typeof document === 'undefined') return undefined;
        const element = document.createElement('style');
        element.setAttribute('data-dsh-quote-styles', '');
        element.textContent = STYLES;
        document.head.appendChild(element);
        return () => {
          if (element.parentNode !== null) element.parentNode.removeChild(element);
        };
      }, [enabled]);
    }

    // ── Composer bridge ──────────────────────────────────────────────────────

    /**
     * An invisible occupant of `conversation.input.activity`.
     *
     * It draws nothing in the toolbar; it renders the floating Quote button into
     * a `document.body` portal instead, so no composer container can clip it.
     * The button follows the conversation selection and disappears on every
     * event that invalidates it: a collapsed selection, a click elsewhere,
     * Escape, a scroll, or a session change.
     */
    function QuoteComposerBridge({ onActiveChange, inputActions, sessionId }) {
      const [anchor, setAnchor] = useState(null);
      const [position, setPosition] = useState(null);
      // The right-click menu: the browser's own menu offers "Copy", and this one
      // offers Copy and Quote side by side, so a quote is one gesture away.
      const [menu, setMenu] = useState(null);
      const [enabled, setEnabled] = useState(() => configStore.config.enabled === true);
      const buttonRef = useRef(null);
      const menuRef = useRef(null);
      const clearRef = useRef(null);

      // The toolbar must keep its ordinary controls: this occupant is a
      // listening post, not an expanded activity.
      useEffect(() => {
        clearRef.current = () => setAnchor(null);
      }, []);

      useEffect(() => {
        if (typeof onActiveChange === 'function') onActiveChange(false);
      }, [onActiveChange]);

      // Live settings: the plugin page writes, this component reads. Only the
      // master switch needs a render; every other setting is read at use time.
      useEffect(() => {
        setEnabled(configStore.config.enabled === true);
        const unsubscribe = configStore.subscribe((next) => setEnabled(next.enabled === true));
        let cancelled = false;
        fetchHostConfig()
          .then((next) => {
            if (cancelled) return;
            configStore.publish(next);
          })
          .catch(() => {
            // The host may not be reachable yet; the cache is good enough.
          });
        return () => {
          cancelled = true;
          unsubscribe();
        };
      }, []);

      // A new session invalidates any selection from the previous one.
      useEffect(() => {
        setAnchor(null);
      }, [sessionId]);

      usePluginStyles(true);

      /** Quote `text` into the composer without disturbing the draft. */
      const insertQuote = useCallback((text, clipped) => {
        if (typeof text !== 'string' || text === '') return;
        let inserted = false;
        if (inputActions !== null && inputActions !== undefined) {
          try {
            if (typeof inputActions.captureInsertion === 'function'
              && typeof inputActions.insertText === 'function') {
              const span = inputActions.captureInsertion();
              inserted = inputActions.insertText(text, span) === true;
            }
          } catch (error) {
            inserted = false;
          }
          if (inserted !== true && typeof inputActions.setDraft === 'function') {
            try {
              // `setDraft` replaces everything, so rebuild the draft first: the
              // quote is appended to what the user already typed.
              inputActions.setDraft(buildAppendText(readDraftText(), text));
              inserted = true;
            } catch (error) {
              inserted = false;
            }
          }
        }
        if (inserted !== true) {
          console.warn('[dsh-quote] the composer refused the quote', { clipped: clipped === true });
        }
      }, [inputActions]);

      /** Build the quote from the current selection and put it in the composer. */
      const quoteCurrentSelection = useCallback(() => {
        const found = readQuotedSelection();
        if (found === null) return false;
        const current = configStore.config;
        const built = buildQuoteText(found.text, {
          maxLength: current.maxLength,
          attributionEnabled: current.attribution,
          attribution: message('attributionText')
        });
        if (built.text === '') return false;
        insertQuote(built.text, built.clipped);
        return true;
      }, [insertQuote]);

      // Selection tracking, dismissal and the keyboard shortcut all live on the
      // document, because both the transcript and the composer own the selection.
      useEffect(() => {
        const dismiss = () => {
          if (clearRef.current !== null) clearRef.current();
        };

        const evaluate = () => {
          if (configStore.config.enabled !== true) {
            dismiss();
            return;
          }
          const found = readQuotedSelection();
          if (found === null) {
            dismiss();
            return;
          }
          try {
            window.getSelection()?.removeAllRanges();
          } catch (error) {
            // Removing the browser's own highlight is a nicety, not a need.
          }
          const built = buildQuoteText(found.text, {
            maxLength: configStore.config.maxLength,
            attributionEnabled: configStore.config.attribution,
            attribution: message('attributionText')
          });
          setAnchor((previous) => (
            previous !== null && previous.text === found.text && previous.clipped === built.clipped
              ? previous
              : { text: found.text, rect: found.rect, clipped: built.clipped }
          ));
        };

        const scheduleEvaluate = () => {
          // The DOM selection settles one task after the pointer event.
          clearTimeout(evaluateTimer);
          evaluateTimer = setTimeout(evaluate, 0);
        };
        let evaluateTimer = null;

        const onPointerDown = (event) => {
          const target = event.target;
          const insideButton = buttonRef.current !== null
            && typeof target?.nodeType === 'number'
            && buttonRef.current.contains(target) === true;
          const insideMenu = menuRef.current !== null
            && typeof target?.nodeType === 'number'
            && menuRef.current.contains(target) === true;
          if (insideButton || insideMenu) return;
          dismiss();
          setMenu(null);
        };

        /**
         * Take over the browser's context menu when something is selected.
         *
         * With an empty selection the native menu is left alone, so the rest of
         * the page keeps its usual right-click; with a selection the page offers
         * Copy and Quote, because the native Copy is the only thing it can undo.
         */
        const onContextMenu = (event) => {
          if (shouldTakeOverContextMenu(configStore.config.enabled, readQuotedSelection() !== null) !== true) {
            setMenu(null);
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          setMenu({ x: event.clientX, y: event.clientY });
        };

        const onKeyDown = (event) => {
          const current = configStore.config;
          if (event.key === 'Escape') {
            dismiss();
            setMenu(null);
            return;
          }
          if (current.enabled !== true) return;
          if (matchesHotkey(event, parseHotkey(current.hotkey)) !== true) return;
          if (readQuotedSelection() === null) return;
          event.preventDefault();
          event.stopPropagation();
          quoteCurrentSelection();
          dismiss();
        };

        const onScroll = (event) => {
          const target = event.target;
          const insideButton = buttonRef.current !== null
            && typeof target?.nodeType === 'number'
            && buttonRef.current.contains(target) === true;
          if (insideButton) return;
          dismiss();
          setMenu(null);
        };

        document.addEventListener('selectionchange', scheduleEvaluate);
        document.addEventListener('mouseup', scheduleEvaluate);
        document.addEventListener('keyup', scheduleEvaluate);
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('scroll', onScroll, true);
        document.addEventListener('contextmenu', onContextMenu, true);
        window.addEventListener('resize', dismiss);
        window.addEventListener('blur', dismiss);
        document.addEventListener('visibilitychange', dismiss);
        return () => {
          clearTimeout(evaluateTimer);
          document.removeEventListener('selectionchange', scheduleEvaluate);
          document.removeEventListener('mouseup', scheduleEvaluate);
          document.removeEventListener('keyup', scheduleEvaluate);
          document.removeEventListener('pointerdown', onPointerDown, true);
          document.removeEventListener('keydown', onKeyDown, true);
          document.removeEventListener('scroll', onScroll, true);
          document.removeEventListener('contextmenu', onContextMenu, true);
          window.removeEventListener('resize', dismiss);
          window.removeEventListener('blur', dismiss);
          document.removeEventListener('visibilitychange', dismiss);
        };
      }, [quoteCurrentSelection]);

      // Position only once the button has been measured, so it never overflows.
      useEffect(() => {
        if (anchor === null) {
          setPosition(null);
          return undefined;
        }
        const place = () => {
          const button = buttonRef.current;
          const rect = button?.getBoundingClientRect?.();
          const size = rect !== undefined && rect !== null && rect.width > 0
            ? { width: rect.width, height: rect.height }
            : { width: 108, height: 28 };
          setPosition(computeQuotePosition(anchor.rect ?? { top: 0, left: 0, bottom: 0, width: 0 }, size));
        };
        place();
        const frame = window.requestAnimationFrame?.(place);
        return () => {
          if (frame !== undefined) window.cancelAnimationFrame?.(frame);
        };
      }, [anchor]);

      const portalContainer = usePortalContainer();

      /** Put the selection on the clipboard, the way the native menu would. */
      const copySelection = useCallback(() => {
        const found = readQuotedSelection();
        if (found === null) return false;
        try {
          navigator?.clipboard?.writeText?.(found.text);
        } catch (error) {
          console.warn('[dsh-quote] the clipboard refused the selection', error);
        }
        return true;
      }, []);

      const button = anchor === null || enabled !== true || position === null
        ? null
        : h('button', {
          ref: buttonRef,
          type: 'button',
          className: 'dsh-quote-btn',
          'data-dsh-quote': '',
          'data-clipped': String(anchor.clipped === true),
          style: { top: `${position.top}px`, left: `${position.left}px` },
          title: message('quoteHint', { hotkey: formatHotkeyLabel(config.hotkey) }),
          'aria-label': message('quote'),
          onMouseDown: (event) => event.preventDefault(),
          onPointerDown: (event) => event.stopPropagation(),
          onClick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            quoteCurrentSelection();
            if (clearRef.current !== null) clearRef.current();
          }
        },
          h(IconQuote, { size: 13 }),
          h('span', null, message('quote'))
        );

      // The right-click menu replaces the native one only while text is selected,
      // and keeps its two actions: copy, exactly as before, and quote.
      const viewportWidth = typeof window === 'undefined' ? 1200 : (window.innerWidth || 1200);
      const viewportHeight = typeof window === 'undefined' ? 800 : (window.innerHeight || 800);
      const menuNode = menu === null || enabled !== true
        ? null
        : h('div', {
          ref: menuRef,
          className: 'dsh-quote-menu',
          'data-dsh-quote-menu': '',
          role: 'menu',
          style: {
            top: `${Math.max(8, Math.min(menu.y, viewportHeight - 88))}px`,
            left: `${Math.max(8, Math.min(menu.x, viewportWidth - 190))}px`
          },
          onMouseDown: (event) => event.preventDefault(),
          onPointerDown: (event) => event.stopPropagation(),
          onContextMenu: (event) => {
            event.preventDefault();
            event.stopPropagation();
          }
        },
          h('button', {
            type: 'button',
            role: 'menuitem',
            className: 'dsh-quote-menu-item',
            onClick: () => {
              copySelection();
              setMenu(null);
            }
          }, message('copy')),
          h('button', {
            type: 'button',
            role: 'menuitem',
            className: 'dsh-quote-menu-item dsh-quote-menu-item-accent',
            onClick: () => {
              quoteCurrentSelection();
              setMenu(null);
              if (clearRef.current !== null) clearRef.current();
            }
          }, message('quote'))
        );

      if (button === null && menuNode === null) return null;
      const layer = h('div', { className: 'dsh-quote-layer' }, button, menuNode);
      if (portalContainer !== null && reactDom !== null && typeof reactDom.createPortal === 'function') {
        return reactDom.createPortal(layer, portalContainer);
      }
      return layer;
    }

    /**
     * A body-level container for the floating button.
     *
     * Rendering through a portal is what makes `position: fixed` dependable
     * here: the composer row declares `container-type: inline-size`, and a
     * container-type ancestor can become the containing block for fixed
     * descendants. The portal sidesteps that entirely.
     */
    function usePortalContainer() {
      const [container, setContainer] = useState(null);
      useEffect(() => {
        const element = document.createElement('div');
        element.className = 'dsh-quote-anchor';
        element.setAttribute('data-dsh-quote-portal', '');
        document.body.appendChild(element);
        setContainer(element);
        return () => {
          setContainer(null);
          if (element.parentNode !== null) element.parentNode.removeChild(element);
        };
      }, []);
      return container;
    }

    // ── Settings card ────────────────────────────────────────────────────────

    /**
     * The settings surface shown on the plugin's page and behind the row's
     * Configure control. It writes through the host route and publishes the
     * answer into `configStore`, so a save takes effect in the composer at once.
     */
    function QuoteSettings() {
      const [draft, setDraft] = useState(() => configStore.config);
      const [status, setStatus] = useState('');
      const [failed, setFailed] = useState(false);
      const [recording, setRecording] = useState(false);
      // The number field keeps its own text so a half-typed value is never
      // reformatted under the user's cursor; it is committed when it loses focus.
      const [maxLengthText, setMaxLengthText] = useState(() => String(configStore.config.maxLength));

      usePluginStyles(true);

      useEffect(() => {
        let cancelled = false;
        fetchHostConfig().then((next) => {
          if (cancelled) return;
          configStore.publish(next);
          setDraft(next);
          setMaxLengthText(String(next.maxLength));
        }).catch(() => {
          if (cancelled) return;
          setFailed(true);
          setStatus(message('loadFailed'));
        });
        return () => {
          cancelled = true;
        };
      }, []);

      const preview = useMemo(() => {
        const limit = Number.parseInt(maxLengthText, 10);
        const built = buildQuoteText(
          LANGUAGE === 'ru' ? 'Первая строка примера\nВторая строка примера' : 'First example line\nSecond example line',
          {
            maxLength: Number.isFinite(limit) && limit > 0 ? limit : draft.maxLength,
            attributionEnabled: draft.attribution,
            attribution: message('attributionText')
          }
        );
        return built.text;
      }, [maxLengthText, draft.maxLength, draft.attribution]);

      const save = (patch) => {
        setStatus(message('saving'));
        setFailed(false);
        persistConfig(patch)
          .then((next) => {
            configStore.publish(next);
            setDraft(next);
            setStatus(message('saved'));
          })
          .catch((error) => {
            setFailed(true);
            setStatus(message('saveFailed', { error: error?.message ?? String(error) }));
          });
      };

      const saveHotkey = (expression) => {
        const normalized = typeof expression === 'string' ? expression.trim() : '';
        if (parseHotkey(normalized) === null) {
          setFailed(true);
          setStatus(message('modifierRequired'));
          return;
        }
        setDraft((previous) => ({ ...previous, hotkey: normalized }));
        save({ hotkey: normalized });
      };

      const hotkeyField = h('div', {
        className: 'dsh-quote-field-input dsh-quote-hotkey-field',
        'data-recording': String(recording),
        tabIndex: 0,
        role: 'button',
        title: message('hotkeyHint'),
        onKeyDown: (event) => {
          if (recording !== true) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === 'Escape') {
            setRecording(false);
            return;
          }
          const captured = hotkeyFromEvent(event);
          if (captured === null) {
            setFailed(true);
            setStatus(message('modifierRequired'));
            return;
          }
          setRecording(false);
          saveHotkey(captured);
        },
        onClick: () => setRecording(true),
        onBlur: () => setRecording(false)
      }, recording === true
        ? message('recording')
        : (parseHotkey(draft.hotkey) !== null ? formatHotkeyLabel(draft.hotkey) : message('hotkeyPlaceholder')));

      return h('div', { className: 'dsh-quote-form' },
        h('div', { className: 'dsh-quote-title' }, h(IconQuote, { size: 14 }), h('span', null, message('title'))),
        h('p', { className: 'dsh-quote-intro' }, message('intro')),

        h('label', { className: 'dsh-quote-row' },
          h('input', {
            type: 'checkbox',
            checked: draft.enabled,
            onChange: (event) => {
              const next = { ...draft, enabled: event.target.checked };
              setDraft(next);
              save({ enabled: next.enabled });
            }
          }),
          h('span', { className: 'dsh-quote-row-label' }, message('enabled'))
        ),

        h('div', { className: 'dsh-quote-field' },
          h('label', { className: 'dsh-quote-row' },
            h('input', {
              type: 'checkbox',
              checked: draft.attribution,
              onChange: (event) => {
                const next = { ...draft, attribution: event.target.checked };
                setDraft(next);
                save({ attribution: next.attribution });
              }
            }),
            h('span', { className: 'dsh-quote-row-label' }, message('attribution'))
          ),
          h('div', { className: 'dsh-quote-field-hint' }, message('attributionHint', { text: message('attributionText') }))
        ),

        h('div', { className: 'dsh-quote-field' },
          h('label', { className: 'dsh-quote-field-label' }, message('maxLength')),
          h('input', {
            className: 'dsh-quote-field-input dsh-quote-input-short',
            type: 'number',
            min: 200,
            max: 20000,
            step: 100,
            value: maxLengthText,
            onChange: (event) => setMaxLengthText(event.target.value),
            onBlur: (event) => {
              const bounded = Math.min(20000, Math.max(200, Number.parseInt(event.target.value, 10) || draft.maxLength));
              setMaxLengthText(String(bounded));
              setDraft((previous) => ({ ...previous, maxLength: bounded }));
              save({ maxLength: bounded });
            }
          }),
          h('div', { className: 'dsh-quote-field-hint' }, message('maxLengthHint', { min: 200, max: 20000 }))
        ),

        h('div', { className: 'dsh-quote-field' },
          h('label', { className: 'dsh-quote-field-label' }, message('hotkey')),
          h('div', { className: 'dsh-quote-hotkey' }, hotkeyField),
          h('button', {
            type: 'button',
            className: 'dsh-quote-link',
            onClick: () => saveHotkey(FALLBACK_HOTKEY)
          }, message('restore')),
          h('div', { className: 'dsh-quote-field-hint' }, message('hotkeyHint'))
        ),

        h('div', { className: 'dsh-quote-field' },
          h('label', { className: 'dsh-quote-field-label' }, message('preview')),
          h('pre', { className: 'dsh-quote-preview' }, preview)
        ),

        h('div', { className: 'dsh-quote-actions' },
          h('button', {
            type: 'button',
            className: 'dsh-quote-action dsh-quote-action-primary',
            onClick: () => {
              const next = { ...DEFAULT_CONFIG };
              setDraft(next);
              setMaxLengthText(String(next.maxLength));
              save(next);
            }
          }, message('reset')),
          h('button', {
            type: 'button',
            className: 'dsh-quote-action',
            onClick: () => {
              setStatus('');
              fetchHostConfig().then((next) => {
                configStore.publish(next);
                setDraft(next);
                setMaxLengthText(String(next.maxLength));
              }).catch(() => {
                setDraft({ ...DEFAULT_CONFIG });
                setMaxLengthText(String(DEFAULT_CONFIG.maxLength));
              });
            }
          }, message('reload')),
          status !== '' && h('span', {
            className: failed ? 'dsh-quote-status dsh-quote-status-error' : 'dsh-quote-status'
          }, status)
        ),

        // The plugin updates itself, so the card also carries the version and the
        // single button that installs a newer revision.
        h(QuoteUpdates)
      );
    }

    /** One-line description for the plugin card, a form for its page. */
    function QuoteSettingsSlot({ view }) {
      if (view === 'summary') return message('summary');
      return h(QuoteSettings);
    }

    // ── Registration ─────────────────────────────────────────────────────────

    return {
      inject: ['slots'],
      apply(ctx) {
        // The composer seat for this bridge is a *list* slot on purpose:
        // `conversation.input.activity` is `kind: "single"`, so occupying it
        // evicts whichever plugin registered there first — which is exactly how
        // this plugin used to kill the voice plugin's microphone at startup
        // ("single slot already has a registration at priority 0"). The bridge
        // draws nothing inline (the button goes through a body portal), so any
        // session-scoped composer list accepts it, and `inputActions` still
        // arrives from the session-scoped provide channel.
        ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right',
          id: 'dsh-quote',
          order: 5
        }, QuoteComposerBridge));

        // Settings live on the plugin's own page in Plugins, and on the row's
        // page behind its Configure control.
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: 'dsh-quote'
        }, QuoteSettingsSlot));

        ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
          name: 'plugins.row.config',
          key: 'dsh-quote#quote'
        }, QuoteSettingsSlot));
      },
      /**
       * Test surface. `test/quote-logic-check.mjs` loads this file with a fake
       * module loader and drives the very same formatting functions the composer
       * runs, so a rule change can never pass the tests by drifting from itself.
       * Nothing here is referenced by the plugin at runtime.
       */
      __test: {
        DEFAULT_CONFIG,
        FALLBACK_HOTKEY,
        message,
        language: LANGUAGE,
        dictionaries: DICTIONARIES,
        normalizeSelectionText,
        truncateText,
        quoteLine,
        buildQuoteText,
        buildAppendText,
        parseHotkey,
        matchesHotkey,
        formatHotkeyLabel,
        hotkeyFromEvent,
        normalizeConfig,
        computeQuotePosition,
        isEditableNode,
        isInsideEditable,
        shouldTakeOverContextMenu,
        QuoteComposerBridge,
        QuoteSettings,
        QuoteSettingsSlot
      }
    };
  }
});
