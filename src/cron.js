// Núcleo do Cron Explicado: interpreta expressões cron de 5 campos (sintaxe do
// Vixie cron/cronie), descreve em português e calcula as próximas execuções.
// Sem acesso ao DOM: é este módulo que os testes importam.

export class CronError extends Error {
  constructor(message, field = -1) {
    super(message);
    this.name = 'CronError';
    this.field = field;
  }
}

const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DOW_ABBR = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export const FIELDS = [
  { key: 'minute', name: 'minuto', title: 'Minuto', min: 0, max: 59 },
  { key: 'hour', name: 'hora', title: 'Hora', min: 0, max: 23 },
  { key: 'dom', name: 'dia do mês', title: 'Dia do mês', min: 1, max: 31 },
  { key: 'month', name: 'mês', title: 'Mês', min: 1, max: 12, names: MONTH_ABBR, nameBase: 1 },
  { key: 'dow', name: 'dia da semana', title: 'Dia da semana', min: 0, max: 7, names: DOW_ABBR, nameBase: 0 },
];

export const MACROS = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
  '@reboot': null,
};

export const MONTHS_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const MONTHS_ABBR_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const DOW_PT = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
export const DOW_ABBR_PT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const DOW_SHORT = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const DOW_PLURAL = ['domingos', 'segundas-feiras', 'terças-feiras', 'quartas-feiras', 'quintas-feiras', 'sextas-feiras', 'sábados'];
const DOW_PLURAL_SHORT = ['domingos', 'segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados'];
const ISO_WEEK = [1, 2, 3, 4, 5, 6, 0];
const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
// Maior dia possível em cada mês (fevereiro com 29 por causa dos anos bissextos).
const MAX_DAYS = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MAX_YEARS = 400; // um ciclo completo do calendário gregoriano

const FIELD_LIKE = /^(?:[0-9*?/,#LW-]|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|SUN|MON|TUE|WED|THU|FRI|SAT)+$/i;
const QUARTZ_LW = /^(?:L|LW|\d*L|\d+W)$/i;

// ---------- utilidades de texto ----------

export function joinPt(list, conj = 'e') {
  if (list.length === 0) return '';
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(', ')} ${conj} ${list[list.length - 1]}`;
}

const pad2 = (n) => String(n).padStart(2, '0');
const hhmm = (h, m) => `${pad2(h)}:${pad2(m)}`;

function toRuns(values) {
  const runs = [];
  for (const v of values) {
    const last = runs[runs.length - 1];
    if (last && v === last[1] + 1) last[1] = v;
    else runs.push([v, v]);
  }
  return runs;
}

// Sequências contíguas considerando que a ordem "dá a volta" (dias da semana, meses).
function cyclicRuns(values, order) {
  const has = new Set(values);
  if (order.every((v) => has.has(v))) return [order.slice()];
  const start = order.findIndex((v) => !has.has(v));
  const runs = [];
  let current = null;
  for (let k = 1; k <= order.length; k++) {
    const v = order[(start + k) % order.length];
    if (!has.has(v)) { current = null; continue; }
    if (current) current.push(v);
    else { current = [v]; runs.push(current); }
  }
  return runs.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
}

function isArithmetic(values) {
  if (values.length < 3) return false;
  const d = values[1] - values[0];
  return values.every((v, i) => i === 0 || v - values[i - 1] === d);
}

export function formatNumberList(values) {
  if (values.length > 6 && isArithmetic(values) && values[1] - values[0] > 1) {
    return `${values[0]}, ${values[1]}, ${values[2]}, …, ${values[values.length - 1]}`;
  }
  const tokens = [];
  for (const [a, b] of toRuns(values)) {
    if (b - a >= 2) tokens.push(`${a} a ${b}`);
    else if (a === b) tokens.push(String(a));
    else tokens.push(String(a), String(b));
  }
  return joinPt(tokens);
}

// ---------- análise sintática ----------

function parseValue(token, def, fail) {
  let n;
  if (/^\d+$/.test(token)) {
    n = Number(token);
  } else if ((def.key === 'dom' || def.key === 'dow') && QUARTZ_LW.test(token)) {
    fail(`“${token}” usa “L” ou “W” (último dia, dia útil mais próximo), extensões do Quartz e de outros agendadores que o cron padrão não aceita.`);
  } else if (/^[a-z]+$/i.test(token)) {
    if (!def.names) fail(`“${token}” não é um número.`);
    const i = def.names.indexOf(token.toUpperCase());
    if (i === -1) {
      fail(`nome desconhecido “${token}”. Use ${joinPt(def.names, 'ou')} (nomes em inglês, com maiúsculas ou minúsculas).`);
    }
    n = i + def.nameBase;
  } else {
    fail(`“${token}” não é um valor válido.`);
  }
  if (n < def.min || n > def.max) {
    const extra = def.key === 'dow' ? ', em que 0 e 7 são domingo' : '';
    fail(`o valor ${n} está fora do intervalo permitido (${def.min} a ${def.max}${extra}).`);
  }
  return n;
}

function wrapHint(def, start, end) {
  const last = def.key === 'dow' ? 6 : def.max;
  if (def.key === 'dow' && start === 7) return ` Domingo também é 0: use 0-${end}.`;
  const first = start === last ? String(last) : `${start}-${last}`;
  const second = end === def.min ? String(def.min) : `${def.min}-${end}`;
  return ` Para “dar a volta”, use dois trechos: ${first},${second}.`;
}

function parseField(raw, index) {
  const def = FIELDS[index];
  const where = `Campo “${def.name}” (${index + 1}º)`;
  const fail = (msg) => { throw new CronError(`${where}: ${msg}`, index); };
  if (raw.includes('?')) fail('o “?” é da sintaxe do Quartz/Spring e não existe no cron padrão. Use “*”.');
  if (raw.includes('#')) fail('a forma com “#” (como 5#3, “terceira sexta-feira do mês”) não existe no cron padrão.');

  const values = new Set();
  const items = [];
  const warnings = [];
  for (const item of raw.split(',')) {
    if (item === '') fail('há um item vazio na lista (vírgula sobrando ou repetida).');
    const parts = item.split('/');
    if (parts.length > 2) fail(`“${item}” tem mais de uma barra.`);
    const [base, stepText] = parts;
    let step = 1;
    if (stepText !== undefined) {
      if (!/^\d+$/.test(stepText)) fail(`o passo “${stepText}” precisa ser um número inteiro, como em */15.`);
      step = Number(stepText);
      if (step === 0) fail('o passo precisa ser maior que zero.');
    }
    let kind;
    let start;
    let end;
    if (base === '*') {
      kind = 'all';
      start = def.min;
      end = def.max;
    } else {
      if (base === '') fail(`falta o valor antes da barra em “${item}”.`);
      const ends = base.split('-');
      if (ends.length > 2 || ends.includes('')) fail(`“${base}” não é um intervalo válido. Use início-fim, como 1-5.`);
      if (ends.includes('*')) fail('o “*” só pode aparecer sozinho ou com passo, como em */5.');
      start = parseValue(ends[0], def, fail);
      if (ends.length === 2) {
        kind = 'range';
        end = parseValue(ends[1], def, fail);
        if (start > end) {
          fail(`o intervalo “${base}” está invertido: o início precisa ser menor ou igual ao fim.${wrapHint(def, start, end)}`);
        }
      } else if (stepText !== undefined) {
        kind = 'range'; // "5/15" vale de 5 até o fim do campo
        end = def.max;
      } else {
        kind = 'value';
        end = start;
      }
    }
    if (step > 1 && start + step > end) {
      warnings.push(`${where}: com passo ${step}, “${item}” só produz o valor ${start}.`);
    }
    for (let v = start; v <= end; v += step) values.add(def.key === 'dow' && v === 7 ? 0 : v);
    items.push({ kind, start, end, step, raw: item });
  }
  const sorted = [...values].sort((a, b) => a - b);
  const size = def.key === 'dow' ? 7 : def.max - def.min + 1;
  return { raw, values: sorted, items, star: raw.startsWith('*'), full: sorted.length === size, warnings };
}

function parseMacro(source) {
  const [name, ...rest] = source.split(/\s+/);
  const lower = name.toLowerCase();
  if (!(lower in MACROS)) {
    throw new CronError(`Atalho desconhecido “${name}”. Os atalhos válidos são ${joinPt(Object.keys(MACROS))}.`);
  }
  if (lower !== name) throw new CronError(`Escreva o atalho em minúsculas: ${lower}.`);
  const command = rest.join(' ');
  if (lower === '@reboot') {
    return { source, macro: lower, reboot: true, expression: null, command, fields: [], warnings: [] };
  }
  const expression = MACROS[lower];
  const fields = expression.split(' ').map((raw, i) => parseField(raw, i));
  return { source, macro: lower, reboot: false, expression, command, fields, warnings: [] };
}

export function parseCron(input) {
  const source = String(input ?? '').trim();
  if (!source) throw new CronError('Digite uma expressão cron, por exemplo: 30 8 * * 1-5.');
  if (source.startsWith('@')) return parseMacro(source);
  const tokens = source.split(/\s+/);
  if (tokens.length < 5) {
    throw new CronError(`A expressão precisa de 5 campos (minuto, hora, dia do mês, mês e dia da semana), mas encontrei ${tokens.length}.`);
  }
  let command = '';
  if (tokens.length > 5) {
    if (FIELD_LIKE.test(tokens[5])) {
      throw new CronError(`A expressão tem ${tokens.length} campos, mas o cron padrão usa 5 (minuto, hora, dia do mês, mês e dia da semana). Formatos com 6 ou 7 campos, com segundos ou ano, são do Quartz/Spring e não funcionam no crontab nem no GitHub Actions.`);
    }
    command = source.replace(/^(?:\S+\s+){5}/, '');
  }
  const fields = tokens.slice(0, 5).map((raw, i) => parseField(raw, i));
  const warnings = fields.flatMap((f) => f.warnings);
  return { source, macro: null, reboot: false, expression: tokens.slice(0, 5).join(' '), command, fields, warnings };
}

// ---------- descrição em português ----------

function singleStep(field, def) {
  if (field.items.length !== 1) return null;
  const item = field.items[0];
  if (item.step <= 1) return null;
  return { step: item.step, fromStart: item.start === def.min && item.end === def.max };
}

function fixedTimePhrase(times) {
  if (times.length === 1) {
    const [h, m] = times[0];
    if (h === 0 && m === 0) return 'À meia-noite';
    if (h === 12 && m === 0) return 'Ao meio-dia';
    return `${h <= 1 ? 'À' : 'Às'} ${hhmm(h, m)}`;
  }
  if (times.length === 2 && times[0].join() === '0,0' && times[1].join() === '12,0') return 'À meia-noite e ao meio-dia';
  return `Às ${joinPt(times.map(([h, m]) => hhmm(h, m)))}`;
}

function minutePhrase(f) {
  const v = f.values;
  if (f.full) return { text: 'A cada minuto', positional: false };
  const st = singleStep(f, FIELDS[0]);
  if (st) {
    if (st.fromStart) return { text: `A cada ${st.step} minutos`, positional: false };
    return { text: `A cada ${st.step} minutos, entre os minutos ${v[0]} e ${v[v.length - 1]}`, positional: true };
  }
  if (toRuns(v).length === 1) return { text: `A cada minuto, entre os minutos ${v[0]} e ${v[v.length - 1]}`, positional: true };
  return { text: `Nos minutos ${formatNumberList(v)}`, positional: true };
}

function hourWindowPhrase(hours) {
  const runs = toRuns(hours);
  if (runs.length === 1 || (runs.length <= 3 && runs.some(([a, b]) => b > a))) {
    return joinPt(runs.map(([a, b]) => `das ${hhmm(a, 0)} às ${hhmm(b, 59)}`));
  }
  return `durante as horas ${formatNumberList(hours)}`;
}

function describeTime(minF, hourF) {
  const mins = minF.values;
  const hours = hourF.values;
  if (mins.length === 1) {
    const m = mins[0];
    const atMinute = m === 0 ? 'em ponto' : `no minuto ${m}`;
    if (hourF.full) return { text: `A cada hora, ${atMinute}`, fixed: false };
    if (hours.length >= 3 && toRuns(hours).length === 1) {
      return { text: `De hora em hora, das ${hhmm(hours[0], m)} às ${hhmm(hours[hours.length - 1], m)}`, fixed: false };
    }
    const st = singleStep(hourF, FIELDS[1]);
    if (st && hours.length > 4) {
      let text = `A cada ${st.step} horas, ${atMinute}`;
      if (!st.fromStart) text += `, das ${hhmm(hours[0], m)} às ${hhmm(hours[hours.length - 1], m)}`;
      return { text, fixed: false };
    }
    return { text: fixedTimePhrase(hours.map((h) => [h, m])), fixed: true };
  }
  if (mins.length * hours.length <= 4) {
    const times = [];
    for (const h of hours) for (const m of mins) times.push([h, m]);
    return { text: fixedTimePhrase(times), fixed: true };
  }
  const mp = minutePhrase(minF);
  if (hourF.full) return { text: mp.text + (mp.positional ? ' de cada hora' : ''), fixed: false };
  return { text: `${mp.text}, ${hourWindowPhrase(hours)}`, fixed: false };
}

const isWeekday = (d) => d >= 1 && d <= 5;

function dowTokens(values) {
  const tokens = [];
  for (const run of cyclicRuns(values, ISO_WEEK)) {
    if (run.length >= 3) tokens.push({ from: run[0], to: run[run.length - 1] });
    else for (const d of run) tokens.push({ day: d });
  }
  return tokens;
}

const dowRange = (a, b) => `de ${isWeekday(a) ? DOW_SHORT[a] : DOW_PT[a]} a ${DOW_PT[b]}`;

export function dowPhrase(values) {
  const tokens = dowTokens(values);
  if (tokens.every((t) => 'day' in t)) {
    const days = tokens.map((t) => t.day);
    if (days.every(isWeekday)) {
      const names = days.map((d) => DOW_PLURAL_SHORT[d]);
      names[names.length - 1] = DOW_PLURAL[days[days.length - 1]];
      return `às ${joinPt(names)}`;
    }
    if (!days.some(isWeekday)) return `aos ${joinPt(days.map((d) => DOW_PLURAL[d]))}`;
  }
  return joinPt(tokens.map((t) => ('day' in t
    ? `${isWeekday(t.day) ? 'às' : 'aos'} ${DOW_PLURAL[t.day]}`
    : dowRange(t.from, t.to))));
}

function dowList(values, conj) {
  return joinPt(dowTokens(values).map((t) => ('day' in t ? DOW_PT[t.day] : dowRange(t.from, t.to))), conj);
}

export function monthPhrase(values) {
  const runs = cyclicRuns(values, ALL_MONTHS);
  if (runs.length === 1 && runs[0].length >= 3) {
    return `de ${MONTHS_PT[runs[0][0] - 1]} a ${MONTHS_PT[runs[0][runs[0].length - 1] - 1]}`;
  }
  return `em ${joinPt(values.map((m) => MONTHS_PT[m - 1]))}`;
}

function domPhrase(values) {
  if (values.length === 1) return `no dia ${values[0]}`;
  if (values.length >= 3 && toRuns(values).length === 1) return `do dia ${values[0]} ao ${values[values.length - 1]}`;
  return `nos dias ${formatNumberList(values)}`;
}

function domWithMonth(domValues, monF) {
  if (monF.full) return { text: `${domPhrase(domValues)} de cada mês`, monthConsumed: false };
  const months = monF.values;
  if (months.length === 1 && domValues.length === 1) {
    const d = domValues[0];
    return { text: `em ${d === 1 ? '1º' : d} de ${MONTHS_PT[months[0] - 1]}`, monthConsumed: true };
  }
  const singles = cyclicRuns(months, ALL_MONTHS).every((r) => r.length < 3);
  if (singles && months.length <= 4) {
    return { text: `${domPhrase(domValues)} de ${joinPt(months.map((m) => MONTHS_PT[m - 1]))}`, monthConsumed: true };
  }
  return { text: domPhrase(domValues), monthConsumed: false };
}

function describeDays(fields) {
  const [, , domF, monF, dowF] = fields;
  const orMode = !domF.star && !dowF.star;
  if (orMode) {
    if (domF.full || dowF.full) return { text: '', monthConsumed: false };
    const dom = domPhrase(domF.values) + (monF.full ? ' de cada mês' : '');
    return { text: `${dom} ou ${dowPhrase(dowF.values)}`, monthConsumed: false };
  }
  if (domF.full && dowF.full) return { text: '', monthConsumed: false };
  if (domF.full) return { text: dowPhrase(dowF.values), monthConsumed: false };
  if (dowF.full) return domWithMonth(domF.values, monF);
  const dom = domPhrase(domF.values) + (monF.full ? ' de cada mês' : '');
  return { text: `${dom}, desde que seja ${dowList(dowF.values, 'ou')}`, monthConsumed: false };
}

export function describe(parsed) {
  if (parsed.reboot) return 'Uma vez, quando o serviço cron é iniciado (normalmente na inicialização do sistema)';
  const [minF, hourF, , monF] = parsed.fields;
  const time = describeTime(minF, hourF);
  const days = describeDays(parsed.fields);
  const parts = [time.text];
  if (days.text) parts.push(days.text);
  else if (time.fixed) parts.push('todos os dias');
  if (!monF.full && !days.monthConsumed) parts.push(monthPhrase(monF.values));
  return parts.join(', ');
}

// ---------- observações e alertas ----------

function validDatePairs(domF, monF) {
  const pairs = [];
  for (const m of monF.values) for (const d of domF.values) if (d <= MAX_DAYS[m]) pairs.push([m, d]);
  return pairs;
}

function domDecides(fields) {
  const [, , domF, , dowF] = fields;
  return !domF.full && (domF.star || dowF.star);
}

export function isFeasible(parsed) {
  if (parsed.reboot) return false;
  if (!domDecides(parsed.fields)) return true;
  return validDatePairs(parsed.fields[2], parsed.fields[3]).length > 0;
}

function impossibleText(domF, monF) {
  const months = joinPt(monF.values.map((m) => MONTHS_PT[m - 1]));
  const verb = monF.values.length === 1 ? 'tem' : 'têm';
  const days = domF.values.length === 1 ? `dia ${domF.values[0]}` : `os dias ${formatNumberList(domF.values)}`;
  return `Essa expressão nunca executa: ${months} não ${verb} ${days}.`;
}

function stepWrapNote(field, idx) {
  const st = singleStep(field, FIELDS[idx]);
  if (!st || !st.fromStart) return null;
  const size = idx === 0 ? 60 : 24;
  if (size % st.step === 0 || field.values.length < 2) return null;
  const v = field.values;
  const last = v[v.length - 1];
  if (idx === 0) {
    return `Com “${field.raw}”, os minutos são ${formatNumberList(v)}, e a contagem recomeça a cada hora: do minuto ${last} para o minuto 0 da hora seguinte passam só ${size - last} minutos.`;
  }
  return `Com “${field.raw}”, as horas são ${formatNumberList(v)}, e a contagem recomeça à meia-noite: das ${hhmm(last, 0)} para as 00:00 passam só ${size - last} horas.`;
}

function minGapBelow(fields, limit) {
  const [minF, hourF] = fields;
  const m = minF.values;
  for (let i = 1; i < m.length; i++) if (m[i] - m[i - 1] < limit) return true;
  const h = hourF.values;
  const consecutiveHours = h.some((x, i) => i > 0 && x - h[i - 1] === 1);
  return consecutiveHours && 60 - m[m.length - 1] + m[0] < limit;
}

export function analyze(parsed) {
  const notes = [];
  const info = (text) => notes.push({ level: 'info', text });
  const warn = (text) => notes.push({ level: 'warn', text });
  if (parsed.reboot) {
    info('O @reboot não tem horário: roda uma única vez quando o serviço cron inicia. Por isso não há próximas execuções para mostrar.');
    return notes;
  }
  if (parsed.macro) info(`O atalho ${parsed.macro} equivale a “${parsed.expression}”.`);
  for (const w of parsed.warnings) warn(w);

  const [minF, hourF, domF, monF, dowF] = parsed.fields;
  if (domDecides(parsed.fields)) {
    const pairs = validDatePairs(domF, monF);
    if (pairs.length === 0) {
      warn(impossibleText(domF, monF));
      return notes;
    }
    if (pairs.every(([m, d]) => m === 2 && d === 29)) {
      info('Só executa em anos bissextos: 29 de fevereiro não existe nos outros anos.');
    }
  }
  const explicitDays = domF.items.every((it) => it.kind === 'value');
  if (!domF.full && explicitDays) {
    const short = (d) => monF.values.filter((m) => MAX_DAYS[m] < d);
    if (domF.values.includes(31) && short(31).length) {
      info('Meses sem o dia 31 ficam sem essa execução: o cron não ajusta para o último dia do mês.');
    } else if (domF.values.includes(30) && short(30).length) {
      info('Fevereiro não tem dia 30 e fica sem essa execução: o cron não ajusta para o último dia do mês.');
    } else if (domF.values.includes(29) && monF.values.includes(2) && !notes.some((n) => n.text.startsWith('Só executa'))) {
      info('Em fevereiro, o dia 29 só existe nos anos bissextos.');
    }
  }

  const orMode = !domF.star && !dowF.star;
  if (orMode) {
    if (domF.full || dowF.full) {
      info('Os campos “dia do mês” e “dia da semana” estão ambos restritos, mas um deles cobre todos os dias. Como basta um dos dois coincidir, a execução acontece todos os dias.');
    } else {
      info('Atenção: como os campos “dia do mês” e “dia da semana” estão ambos restritos, o cron executa quando qualquer um dos dois coincide (regra do Vixie cron), e não apenas quando os dois coincidem ao mesmo tempo.');
    }
  } else if (!domF.full && !dowF.full) {
    const which = domF.star ? '“dia do mês”' : '“dia da semana”';
    info(`O campo ${which} começa com “*”, então o cron exige que o dia do mês e o dia da semana coincidam ao mesmo tempo (regra do Vixie cron).`);
  }

  for (const [f, idx] of [[minF, 0], [hourF, 1]]) {
    const note = stepWrapNote(f, idx);
    if (note) info(note);
  }
  if (minGapBelow(parsed.fields, 5)) {
    info('Se for usar no GitHub Actions: lá o intervalo mínimo entre execuções agendadas é de 5 minutos.');
  }
  return notes;
}

// ---------- resumo campo a campo ----------

const FULL_TEXT = ['todos (0 a 59)', 'todas (0 a 23)', 'todos (1 a 31)', 'todos', 'todos'];

export function summarizeField(field, idx) {
  let text;
  if (field.full) text = FULL_TEXT[idx];
  else if (idx === 3) text = joinPt(field.values.map((m) => MONTHS_PT[m - 1]));
  else if (idx === 4) text = joinPt(ISO_WEEK.filter((d) => field.values.includes(d)).map((d) => DOW_PT[d]));
  else text = formatNumberList(field.values);
  return { title: FIELDS[idx].title, raw: field.raw, text };
}

// ---------- próximas execuções ----------

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function nextRuns(parsed, from = new Date(), count = 10, { utc = false } = {}) {
  if (!isFeasible(parsed) || count <= 0) return [];
  const [minF, hourF, domF, monF, dowF] = parsed.fields;
  const andMode = domF.star || dowF.star;
  const domSet = new Set(domF.values);
  const dowSet = new Set(dowF.values);
  const dayMatches = (y, mo, d) => {
    const domOk = domSet.has(d);
    const dowOk = dowSet.has(new Date(Date.UTC(y, mo - 1, d)).getUTCDay());
    return andMode ? domOk && dowOk : domOk || dowOk;
  };
  const make = utc
    ? (y, mo, d, h, mi) => new Date(Date.UTC(y, mo - 1, d, h, mi))
    : (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi);
  const exists = (date, d, h, mi) => (utc
    || (date.getDate() === d && date.getHours() === h && date.getMinutes() === mi));

  const fromMs = from.getTime();
  const start = new Date(Math.floor(fromMs / 60000) * 60000 + 60000);
  const [y0, mo0, d0, h0, mi0] = utc
    ? [start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate(), start.getUTCHours(), start.getUTCMinutes()]
    : [start.getFullYear(), start.getMonth() + 1, start.getDate(), start.getHours(), start.getMinutes()];

  const runs = [];
  // Percorre só os valores permitidos de cada campo, do maior (ano) para o menor (minuto).
  for (let y = y0; y <= y0 + MAX_YEARS; y++) {
    for (const mo of monF.values) {
      if (y === y0 && mo < mo0) continue;
      const firstMonth = y === y0 && mo === mo0;
      const dim = daysInMonth(y, mo);
      for (let d = firstMonth ? d0 : 1; d <= dim; d++) {
        if (!dayMatches(y, mo, d)) continue;
        const firstDay = firstMonth && d === d0;
        for (const h of hourF.values) {
          if (firstDay && h < h0) continue;
          const firstHour = firstDay && h === h0;
          for (const mi of minF.values) {
            if (firstHour && mi < mi0) continue;
            const date = make(y, mo, d, h, mi);
            // No horário local, horários que não existem (início do horário de verão) são ignorados.
            if (!exists(date, d, h, mi) || date.getTime() <= fromMs) continue;
            runs.push(date);
            if (runs.length >= count) return runs;
          }
        }
      }
    }
  }
  return runs;
}

// ---------- formatação de datas ----------

export function formatRun(date, utc = false) {
  const p = utc
    ? [date.getUTCDay(), date.getUTCDate(), date.getUTCMonth() + 1, date.getUTCFullYear(), date.getUTCHours(), date.getUTCMinutes()]
    : [date.getDay(), date.getDate(), date.getMonth() + 1, date.getFullYear(), date.getHours(), date.getMinutes()];
  const [w, d, mo, y, h, mi] = p;
  return `${DOW_ABBR_PT[w]}, ${pad2(d)}/${pad2(mo)}/${y} às ${hhmm(h, mi)}`;
}

export function formatRelative(ms) {
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 1) return 'em menos de 1 minuto';
  if (totalMin < 60) return `em ${totalMin} min`;
  const totalH = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (totalH < 24) return min ? `em ${totalH} h ${min} min` : `em ${totalH} h`;
  const days = Math.floor(totalH / 24);
  const h = totalH % 24;
  const dayText = days === 1 ? '1 dia' : `${days} dias`;
  return h && days < 7 ? `em ${dayText} e ${h} h` : `em ${dayText}`;
}

// ---------- montador de expressões ----------

export function compressValues(values) {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const parts = [];
  for (const [a, b] of toRuns(sorted)) {
    if (b - a >= 2) parts.push(`${a}-${b}`);
    else if (a === b) parts.push(String(a));
    else parts.push(String(a), String(b));
  }
  return parts.join(',');
}

const BUILDER_MAX = [59, 23, 31, 12, 6];

export function buildField(spec, idx) {
  const def = FIELDS[idx];
  const max = BUILDER_MAX[idx];
  const label = def.title;
  const int = (v, lo, hi, what) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < lo || n > hi) throw new CronError(`${label}: ${what} precisa ser um número inteiro de ${lo} a ${hi}.`, idx);
    return n;
  };
  switch (spec.mode) {
    case 'all':
      return '*';
    case 'step': {
      const step = int(spec.step, 1, max, 'o passo');
      const start = int(spec.start ?? def.min, def.min, max, 'o início');
      if (step === 1 && start === def.min) return '*';
      return start === def.min ? `*/${step}` : `${start}-${max}/${step}`;
    }
    case 'list': {
      if (!spec.values || spec.values.length === 0) throw new CronError(`${label}: escolha pelo menos um valor.`, idx);
      return compressValues(spec.values.map((v) => int(v, def.min, max, 'cada valor')));
    }
    case 'range': {
      const from = int(spec.from, def.min, max, 'o início');
      const to = int(spec.to, def.min, max, 'o fim');
      if (from > to) throw new CronError(`${label}: o início do intervalo precisa ser menor ou igual ao fim.`, idx);
      const step = int(spec.step ?? 1, 1, max, 'o passo');
      if (from === to) return String(from);
      return step > 1 ? `${from}-${to}/${step}` : `${from}-${to}`;
    }
    default:
      throw new CronError(`${label}: modo desconhecido.`, idx);
  }
}

export function buildExpression(specs) {
  return specs.map((spec, i) => buildField(spec, i)).join(' ');
}

// Converte um campo já interpretado no estado equivalente do montador.
export function specFromField(field, idx) {
  const def = FIELDS[idx];
  if (field.full && field.star) return { mode: 'all' };
  if (field.items.length === 1) {
    const it = field.items[0];
    if (it.step > 1 && it.end === def.max && idx !== 4) return { mode: 'step', step: it.step, start: it.start };
    if (it.kind === 'range' && it.end <= BUILDER_MAX[idx]) return { mode: 'range', from: it.start, to: it.end, step: it.step };
  }
  return { mode: 'list', values: field.values.slice() };
}

// Indica se o montador reproduz exatamente a expressão (mesmos valores e mesma regra do "*").
export function sameSchedule(a, b) {
  return a.fields.every((f, i) => f.star === b.fields[i].star && f.values.join() === b.fields[i].values.join());
}

export function explain(input, { now = new Date(), count = 10, utc = false } = {}) {
  let parsed;
  try {
    parsed = parseCron(input);
  } catch (err) {
    if (err instanceof CronError) return { ok: false, error: err.message, field: err.field };
    throw err;
  }
  return {
    ok: true,
    parsed,
    description: describe(parsed),
    notes: analyze(parsed),
    fields: parsed.fields.map((f, i) => summarizeField(f, i)),
    runs: nextRuns(parsed, now, count, { utc }),
  };
}
