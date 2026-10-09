import {
  explain, parseCron, nextRuns, CronError, MONTHS_PT, MONTHS_ABBR_PT, DOW_PT, DOW_ABBR_PT,
  formatRun, formatRelative, buildExpression, specFromField, sameSchedule,
} from './cron.js';

const STORAGE_KEY = 'cron-explicado';
const DEFAULT_EXPR = '30 8 * * 1-5';
const CAPTIONS = ['minuto', 'hora', 'dia do mês', 'mês', 'dia da semana'];

const EXAMPLES = [
  ['*/5 * * * *', 'A cada 5 minutos'],
  ['0 * * * *', 'De hora em hora'],
  ['30 8 * * 1-5', 'Dias úteis às 08:30'],
  ['*/15 9-17 * * 1-5', 'Horário comercial, a cada 15 minutos'],
  ['0 0 * * *', 'Todo dia à meia-noite'],
  ['0 3 * * 0', 'Backup semanal: domingo às 03:00'],
  ['0 0 1 * *', 'Primeiro dia de cada mês'],
  ['0 0 1,15 * *', 'Dias 1 e 15'],
  ['0 18 * * 5', 'Sexta-feira às 18:00'],
  ['0 9 * 12 *', 'Todos os dias de dezembro às 09:00'],
  ['0 0 1 1 *', 'Ano-novo'],
  ['0 0 29 2 *', 'Só em anos bissextos'],
  ['0 0 13 * 5', 'A armadilha da “sexta-feira 13”'],
  ['0 11 * * *', 'GitHub Actions: 08:00 de Brasília'],
  ['@reboot', 'Ao iniciar o sistema'],
];

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const BUILDER = [
  { legend: 'Minuto', min: 0, max: 59, cols: 10, step: 5, label: String, name: String,
    modes: [['all', 'Todo minuto'], ['step', 'A cada N minutos'], ['list', 'Minutos específicos'], ['range', 'Intervalo de minutos']] },
  { legend: 'Hora', min: 0, max: 23, cols: 8, step: 2, label: String, name: String,
    modes: [['all', 'Toda hora'], ['step', 'A cada N horas'], ['list', 'Horas específicas'], ['range', 'Intervalo de horas']] },
  { legend: 'Dia do mês', min: 1, max: 31, cols: 8, step: 2, label: String, name: String,
    modes: [['all', 'Todo dia'], ['step', 'A cada N dias'], ['list', 'Dias específicos'], ['range', 'Intervalo de dias']] },
  { legend: 'Mês', min: 1, max: 12, cols: 6, step: 3, label: (v) => MONTHS_ABBR_PT[v - 1], name: (v) => MONTHS_PT[v - 1],
    modes: [['all', 'Todo mês'], ['step', 'A cada N meses'], ['list', 'Meses específicos'], ['range', 'Intervalo de meses']] },
  { legend: 'Dia da semana', min: 0, max: 6, cols: 7, step: 1, label: (v) => DOW_ABBR_PT[v], name: (v) => DOW_PT[v],
    modes: [['all', 'Qualquer dia da semana'], ['list', 'Dias específicos'], ['range', 'Intervalo de dias']] },
];

const $ = (id) => document.getElementById(id);
const els = {
  input: $('expr'), chips: $('chips'), sentence: $('sentence'), command: $('command'), error: $('error'),
  notes: $('notes'), fieldsBody: $('fields-body'), runs: $('runs'), tz: $('tz'), tzNote: $('tz-note'),
  status: $('status'), builder: $('builder'), builderStatus: $('builder-status'), examples: $('examples'),
  copyExpr: $('copy-expr'), copyLink: $('copy-link'),
};

let current = null;
let statusTimer = 0;
const controls = [];

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

function readStore() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
}

function writeStore(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* armazenamento indisponível */ }
}

const localZone = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
})();

const pad2 = (n) => String(n).padStart(2, '0');

// ---------- explicação ----------

function chip(token, caption, extra = '') {
  return el('li', { class: extra }, el('span', { class: 'tok', text: token }), el('span', { class: 'cap', text: caption }));
}

function renderChips(result) {
  els.chips.replaceChildren();
  const text = els.input.value.trim();
  if (!text) return;
  if (result.ok && result.parsed.reboot) {
    els.chips.append(chip('@reboot', 'sem horário fixo', 'macro'));
    return;
  }
  let tokens;
  if (result.ok) tokens = result.parsed.expression.split(' ');
  else if (text.startsWith('@')) tokens = [];
  else tokens = text.split(/\s+/).slice(0, 5);
  if (!tokens.length) {
    els.chips.append(chip(text.split(/\s+/)[0], 'atalho', 'macro bad'));
    return;
  }
  for (let i = 0; i < 5; i++) {
    const missing = tokens[i] === undefined;
    const bad = !result.ok && (result.field === i || missing);
    els.chips.append(chip(missing ? 'falta' : tokens[i], CAPTIONS[i], bad ? 'bad' : ''));
  }
}

function renderFields(result) {
  els.fieldsBody.replaceChildren();
  if (!result) {
    els.fieldsBody.append(el('tr', {}, el('td', { colspan: '3', class: 'muted', text: 'Corrija a expressão para ver o detalhamento.' })));
    return;
  }
  if (result.parsed.reboot) {
    els.fieldsBody.append(el('tr', {}, el('td', { colspan: '3', class: 'muted', text: 'O @reboot não tem campos de horário.' })));
    return;
  }
  for (const f of result.fields) {
    els.fieldsBody.append(el('tr', {},
      el('th', { scope: 'row', text: f.title }),
      el('td', {}, el('code', { text: f.raw })),
      el('td', { text: f.text })));
  }
}

function localEquivalent(date) {
  const sameDay = date.getDate() === date.getUTCDate();
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  return sameDay ? time : `${time} de ${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}`;
}

function renderRuns(result, now) {
  const utc = els.tz.value === 'utc';
  els.runs.replaceChildren();
  els.tzNote.textContent = utc
    ? `Horários em UTC, como o GitHub Actions calcula. Entre parênteses, o mesmo momento no seu fuso${localZone ? ` (${localZone})` : ''}.`
    : `Horários no fuso do seu navegador${localZone ? ` (${localZone})` : ''}. Num servidor Linux, o cron usa o fuso configurado na máquina; no GitHub Actions, sempre UTC.`;
  const empty = (text) => els.runs.append(el('li', { class: 'empty', text }));
  if (!result) return empty('Corrija a expressão para ver as próximas execuções.');
  if (result.parsed.reboot) return empty('O @reboot não tem horário: roda uma vez quando o serviço cron inicia.');
  if (!result.runs.length) return empty('Nenhuma execução: essa combinação de dia e mês nunca acontece.');
  result.runs.forEach((date, i) => {
    const li = el('li', {}, el('time', { datetime: date.toISOString(), text: formatRun(date, utc) + (utc ? ' UTC' : '') }));
    if (utc) li.append(' ', el('span', { class: 'alt', text: `(${localEquivalent(date)} no seu horário)` }));
    if (i === 0) li.append(' ', el('span', { class: 'rel', text: `· ${formatRelative(date - now)}` }));
    els.runs.append(li);
  });
  return undefined;
}

function render({ fromBuilder = false } = {}) {
  const expr = els.input.value;
  const now = new Date();
  const result = explain(expr, { now, utc: els.tz.value === 'utc', count: 10 });
  current = result;
  renderChips(result);
  els.notes.replaceChildren();
  if (!result.ok) {
    els.input.setAttribute('aria-invalid', 'true');
    els.sentence.textContent = '';
    els.command.hidden = true;
    els.error.hidden = false;
    els.error.replaceChildren(el('strong', { text: 'Expressão inválida. ' }), result.error);
    renderFields(null);
    renderRuns(null, now);
    return;
  }
  els.input.removeAttribute('aria-invalid');
  els.error.hidden = true;
  els.sentence.textContent = result.description;
  els.command.hidden = !result.parsed.command;
  els.command.replaceChildren('Comando: ', el('code', { text: result.parsed.command }));
  for (const note of result.notes) els.notes.append(el('li', { class: note.level, text: note.text }));
  renderFields(result);
  renderRuns(result, now);
  if (!fromBuilder) syncBuilder(result.parsed);
  writeStore({ expr: expr.trim(), tz: els.tz.value });
}

function refreshRuns() {
  if (!current || !current.ok || current.parsed.reboot) return;
  const now = new Date();
  current.runs = nextRuns(current.parsed, now, 10, { utc: els.tz.value === 'utc' });
  renderRuns(current, now);
}

// ---------- montador ----------

function labeled(id, text, control) {
  return el('div', {}, el('label', { for: id, text }), control);
}

function valueSelect(id, cfg) {
  const select = el('select', { id });
  for (const v of range(cfg.min, cfg.max)) select.append(el('option', { value: String(v), text: cfg.name(v) }));
  return select;
}

function createBuilder() {
  BUILDER.forEach((cfg, i) => {
    const id = (suffix) => `b${i}-${suffix}`;
    const mode = el('select', { id: id('mode') });
    for (const [value, text] of cfg.modes) mode.append(el('option', { value, text }));

    const step = el('input', { id: id('step'), type: 'number', min: '1', max: String(cfg.max), inputmode: 'numeric' });
    const start = valueSelect(id('start'), cfg);
    const stepPanel = el('div', { class: 'bpanel' },
      el('div', { class: 'row' }, labeled(id('step'), 'A cada', step), labeled(id('start'), 'Começando em', start)));

    const toggles = el('div', { class: 'toggles', role: 'group', 'aria-label': `${cfg.legend}: valores escolhidos` });
    toggles.style.gridTemplateColumns = `repeat(${cfg.cols}, minmax(0, 1fr))`;
    for (const v of range(cfg.min, cfg.max)) {
      toggles.append(el('button', {
        type: 'button', class: 'toggle', 'aria-pressed': 'false', 'data-value': String(v), 'aria-label': cfg.name(v), text: cfg.label(v),
      }));
    }
    const listPanel = el('div', { class: 'bpanel' }, toggles);

    const from = valueSelect(id('from'), cfg);
    const to = valueSelect(id('to'), cfg);
    const rstep = el('input', { id: id('rstep'), type: 'number', min: '1', max: String(cfg.max), inputmode: 'numeric', value: '1' });
    const rangePanel = el('div', { class: 'bpanel' },
      el('div', { class: 'row' }, labeled(id('from'), 'De', from), labeled(id('to'), 'Até', to), labeled(id('rstep'), 'A cada', rstep)));

    const fieldset = el('fieldset', { class: 'bfield' }, el('legend', { text: cfg.legend }),
      el('label', { for: id('mode'), text: 'Como repetir' }), mode, stepPanel, listPanel, rangePanel);
    els.builder.append(fieldset);
    const c = { fieldset, mode, step, start, toggles, from, to, rstep, panels: { step: stepPanel, list: listPanel, range: rangePanel } };
    controls.push(c);

    mode.addEventListener('change', () => {
      if (mode.value === 'list' && !toggles.querySelector('[aria-pressed="true"]')) {
        toggles.firstElementChild.setAttribute('aria-pressed', 'true');
      }
      showPanel(c);
      onBuilderChange();
    });
    for (const input of [step, start, from, to, rstep]) input.addEventListener('change', onBuilderChange);
    for (const input of [step, rstep]) input.addEventListener('input', onBuilderChange);
    toggles.addEventListener('click', (event) => {
      const button = event.target.closest('.toggle');
      if (!button) return;
      button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
      onBuilderChange();
    });
  });
}

function showPanel(c) {
  for (const [name, panel] of Object.entries(c.panels)) panel.hidden = name !== c.mode.value;
}

function readSpec(c) {
  switch (c.mode.value) {
    case 'step': return { mode: 'step', step: c.step.value, start: c.start.value };
    case 'list': return { mode: 'list', values: [...c.toggles.querySelectorAll('[aria-pressed="true"]')].map((b) => Number(b.dataset.value)) };
    case 'range': return { mode: 'range', from: c.from.value, to: c.to.value, step: c.rstep.value || 1 };
    default: return { mode: 'all' };
  }
}

function setBuilderStatus(content, bad = false) {
  els.builderStatus.className = bad ? 'builder-status bad' : 'builder-status';
  if (typeof content === 'string') {
    if (els.builderStatus.textContent !== content) els.builderStatus.textContent = content;
  } else {
    els.builderStatus.replaceChildren(...content);
  }
}

function onBuilderChange() {
  try {
    const expr = buildExpression(controls.map(readSpec));
    setBuilderStatus(['Expressão gerada: ', el('code', { text: expr })]);
    els.input.value = expr;
    render({ fromBuilder: true });
  } catch (err) {
    if (!(err instanceof CronError)) throw err;
    setBuilderStatus(err.message, true);
  }
}

function setControls(c, cfg, spec, field) {
  c.mode.value = spec.mode;
  const pressed = new Set(field.full ? [] : field.values);
  for (const button of c.toggles.children) {
    button.setAttribute('aria-pressed', String(pressed.has(Number(button.dataset.value))));
  }
  const inBuilder = field.values.filter((v) => v >= cfg.min && v <= cfg.max);
  c.step.value = String(spec.mode === 'step' ? spec.step : cfg.step);
  c.start.value = String(spec.mode === 'step' ? spec.start : cfg.min);
  c.from.value = String(spec.mode === 'range' ? spec.from : (field.full ? cfg.min : inBuilder[0]));
  c.to.value = String(spec.mode === 'range' ? spec.to : (field.full ? cfg.max : inBuilder[inBuilder.length - 1]));
  c.rstep.value = String(spec.mode === 'range' ? spec.step : 1);
  showPanel(c);
}

function syncBuilder(parsed) {
  const disabled = parsed.reboot;
  for (const c of controls) c.fieldset.disabled = disabled;
  if (disabled) {
    setBuilderStatus('O @reboot não tem campos de horário para montar.');
    return;
  }
  const specs = parsed.fields.map((f, i) => specFromField(f, i));
  specs.forEach((spec, i) => setControls(controls[i], BUILDER[i], spec, parsed.fields[i]));
  let exact = false;
  try {
    exact = sameSchedule(parsed, parseCron(buildExpression(specs)));
  } catch {
    exact = false;
  }
  setBuilderStatus(exact ? '' : 'Parte desta expressão não cabe nos controles (por exemplo, listas com passos). Se você mexer aqui, ela será substituída.');
}

// ---------- exemplos, cópia e inicialização ----------

function createExamples() {
  for (const [expr, label] of EXAMPLES) {
    const button = el('button', { type: 'button', class: 'example' }, el('code', { text: expr }), el('span', { text: label }));
    button.addEventListener('click', () => {
      els.input.value = expr;
      render();
      els.input.focus();
    });
    els.examples.append(button);
  }
}

function flash(message) {
  els.status.textContent = message;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { els.status.textContent = ''; }, 3500);
}

async function copyText(text, okMessage) {
  try {
    await navigator.clipboard.writeText(text);
    flash(okMessage);
  } catch {
    flash('Não foi possível copiar automaticamente. Selecione o texto e copie manualmente.');
  }
}

function fromHash() {
  if (location.hash.length <= 1) return null;
  try { return decodeURIComponent(location.hash.slice(1)); } catch { return null; }
}

function init() {
  createBuilder();
  createExamples();
  const stored = readStore();
  els.input.value = fromHash() ?? stored.expr ?? DEFAULT_EXPR;
  if (stored.tz === 'utc') els.tz.value = 'utc';

  els.input.addEventListener('input', () => render());
  els.tz.addEventListener('change', () => render({ fromBuilder: true }));
  els.copyExpr.addEventListener('click', () => copyText(els.input.value.trim(), 'Expressão copiada.'));
  els.copyLink.addEventListener('click', () => {
    const url = `${location.href.split('#')[0]}#${encodeURIComponent(els.input.value.trim())}`;
    copyText(url, 'Link copiado: quem abrir verá esta mesma expressão.');
  });
  window.addEventListener('hashchange', () => {
    const expr = fromHash();
    if (expr !== null) {
      els.input.value = expr;
      render();
    }
  });
  setInterval(refreshRuns, 30000);
  render();
}

init();
