import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCron, describe as describeCron, nextRuns, explain, analyze, CronError,
  buildExpression, compressValues, specFromField, sameSchedule, formatRun, formatRelative, summarizeField,
} from '../src/cron.js';

const values = (expr, i) => parseCron(expr).fields[i].values;
const utcRuns = (expr, fromIso, count = 5) => nextRuns(parseCron(expr), new Date(fromIso), count, { utc: true })
  .map((d) => d.toISOString().slice(0, 16));

test('interpreta listas, intervalos e passos', () => {
  assert.deepEqual(values('0,15,30,45 * * * *', 0), [0, 15, 30, 45]);
  assert.deepEqual(values('* 9-12 * * *', 1), [9, 10, 11, 12]);
  assert.deepEqual(values('*/15 * * * *', 0), [0, 15, 30, 45]);
  assert.deepEqual(values('10-30/5 * * * *', 0), [10, 15, 20, 25, 30]);
  assert.deepEqual(values('5/20 * * * *', 0), [5, 25, 45]);
  assert.deepEqual(values('* * */10 * *', 2), [1, 11, 21, 31]);
  assert.deepEqual(values('* * * */4 *', 3), [1, 5, 9]);
  assert.deepEqual(values('1-3,7,20-21 * * * *', 0), [1, 2, 3, 7, 20, 21]);
  assert.deepEqual(values('08 * * * *', 0), [8]);
});

test('aceita nomes de meses e dias sem diferenciar maiúsculas', () => {
  assert.deepEqual(values('* * * JAN,jul,Dec *', 3), [1, 7, 12]);
  assert.deepEqual(values('* * * mar-MAY *', 3), [3, 4, 5]);
  assert.deepEqual(values('* * * * MON-fri', 4), [1, 2, 3, 4, 5]);
  assert.deepEqual(values('* * * * sun,SAT', 4), [0, 6]);
});

test('0 e 7 são domingo, e o * do dia da semana vai de 0 a 7', () => {
  assert.deepEqual(values('* * * * 7', 4), [0]);
  assert.deepEqual(values('* * * * 0,7', 4), [0]);
  assert.deepEqual(values('* * * * 5-7', 4), [0, 5, 6]);
  assert.deepEqual(values('* * * * */2', 4), [0, 2, 4, 6]);
  assert.deepEqual(values('* * * * 1-7/2', 4), [0, 1, 3, 5]);
  assert.equal(parseCron('* * * * 0-7').fields[4].full, true);
});

test('marca como “*” o campo que começa com asterisco (regra do Vixie cron)', () => {
  const p = parseCron('0 0 */2 * 1-5');
  assert.equal(p.fields[2].star, true);
  assert.equal(p.fields[4].star, false);
  assert.equal(parseCron('0 0 1-31 * *').fields[2].star, false);
});

test('expande os atalhos', () => {
  const cases = {
    '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *', '@weekly': '0 0 * * 0',
    '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@hourly': '0 * * * *',
  };
  for (const [macro, expr] of Object.entries(cases)) {
    const p = parseCron(macro);
    assert.equal(p.expression, expr, macro);
    assert.equal(p.macro, macro);
  }
  const reboot = parseCron('@reboot');
  assert.equal(reboot.reboot, true);
  assert.deepEqual(nextRuns(reboot, new Date(), 10), []);
});

test('separa o comando de uma linha de crontab', () => {
  assert.equal(parseCron('30 2 * * * /usr/local/bin/backup.sh --full').command, '/usr/local/bin/backup.sh --full');
  assert.equal(parseCron('@daily  /opt/limpa.sh').command, '/opt/limpa.sh');
  assert.equal(parseCron('*/5 * * * *').command, '');
});

function expectError(expr, field, pattern) {
  const r = explain(expr);
  assert.equal(r.ok, false, `deveria falhar: ${expr}`);
  assert.equal(r.field, field, `campo errado para ${expr}: ${r.error}`);
  if (pattern) assert.match(r.error, pattern);
}

test('rejeita expressões inválidas com mensagens que apontam o campo', () => {
  expectError('', -1, /Digite uma expressão/);
  expectError('* * * *', -1, /5 campos.*encontrei 4/);
  expectError('0 0 12 * * ?', -1, /6 campos.*Quartz/);
  expectError('0 30 8 * * 1-5', -1, /6 campos/);
  expectError('60 * * * *', 0, /Campo “minuto” \(1º\).*60.*0 a 59/);
  expectError('* 24 * * *', 1, /Campo “hora”.*24.*0 a 23/);
  expectError('* * 0 * *', 2, /Campo “dia do mês”.*0.*1 a 31/);
  expectError('* * 32 * *', 2, /32/);
  expectError('* * * 13 *', 3, /Campo “mês”.*13.*1 a 12/);
  expectError('* * * * 8', 4, /Campo “dia da semana”.*0 e 7 são domingo/);
  expectError('*/0 * * * *', 0, /passo precisa ser maior que zero/);
  expectError('*/x * * * *', 0, /passo “x”/);
  expectError('1,,2 * * * *', 0, /item vazio/);
  expectError('1, * * * *', 0, /item vazio/);
  expectError('* 22-2 * * *', 1, /invertido.*22-23,0-2/);
  expectError('* * * * FRI-MON', 4, /invertido/);
  expectError('* * * JNA *', 3, /nome desconhecido “JNA”/);
  expectError('* * * * SEG', 4, /nome desconhecido “SEG”.*SUN/);
  expectError('MON * * * *', 0, /não é um número/);
  expectError('* * ? * *', 2, /Quartz/);
  expectError('* * L * *', 2, /“L” ou “W”/);
  expectError('* * 15W * *', 2, /“L” ou “W”/);
  expectError('* * * * 5L', 4, /“L” ou “W”/);
  expectError('* * * * 5#3', 4, /#/);
  expectError('1-2-3 * * * *', 0, /intervalo válido/);
  expectError('*-5 * * * *', 0, /só pode aparecer sozinho/);
  expectError('1/2/3 * * * *', 0, /mais de uma barra/);
  expectError('/5 * * * *', 0, /falta o valor/);
  expectError('5.5 * * * *', 0, /não é um valor válido/);
  expectError('@diario', -1, /Atalho desconhecido.*@daily/);
  expectError('@DAILY', -1, /minúsculas: @daily/);
});

test('CronError carrega o índice do campo', () => {
  assert.throws(() => parseCron('* * * 13 *'), (err) => err instanceof CronError && err.field === 3);
});

const DESCRIPTIONS = [
  ['* * * * *', 'A cada minuto'],
  ['*/5 * * * *', 'A cada 5 minutos'],
  ['*/15 9-17 * * *', 'A cada 15 minutos, das 09:00 às 17:59'],
  ['0 * * * *', 'A cada hora, em ponto'],
  ['15 * * * *', 'A cada hora, no minuto 15'],
  ['30 8 * * 1-5', 'Às 08:30, de segunda a sexta-feira'],
  ['0 0 * * *', 'À meia-noite, todos os dias'],
  ['0 12 * * *', 'Ao meio-dia, todos os dias'],
  ['30 1 * * *', 'À 01:30, todos os dias'],
  ['0 0 1,15 * *', 'À meia-noite, nos dias 1 e 15 de cada mês'],
  ['0 12 * 1 0', 'Ao meio-dia, aos domingos, em janeiro'],
  ['0 0 1 1 *', 'À meia-noite, em 1º de janeiro'],
  ['0 9-17 * * 1-5', 'De hora em hora, das 09:00 às 17:00, de segunda a sexta-feira'],
  ['0 8,12,18 * * *', 'Às 08:00, 12:00 e 18:00, todos os dias'],
  ['0 0,12 * * *', 'À meia-noite e ao meio-dia, todos os dias'],
  ['0 */6 * * *', 'Às 00:00, 06:00, 12:00 e 18:00, todos os dias'],
  ['0 */2 * * *', 'A cada 2 horas, em ponto'],
  ['0 8-18/2 * * *', 'A cada 2 horas, em ponto, das 08:00 às 18:00'],
  ['0,30 * * * *', 'Nos minutos 0 e 30 de cada hora'],
  ['10-30/5 * * * *', 'A cada 5 minutos, entre os minutos 10 e 30 de cada hora'],
  ['0,30 9 * * *', 'Às 09:00 e 09:30, todos os dias'],
  ['*/10 */2 * * *', 'A cada 10 minutos, durante as horas 0, 2, 4, …, 22'],
  ['*/15 9-12,14-18 * * 1-5', 'A cada 15 minutos, das 09:00 às 12:59 e das 14:00 às 18:59, de segunda a sexta-feira'],
  ['0 3 * * 6,0', 'Às 03:00, aos sábados e domingos'],
  ['0 18 * * 1,3,5', 'Às 18:00, às segundas, quartas e sextas-feiras'],
  ['0 0 * * 1-6', 'À meia-noite, de segunda a sábado'],
  ['0 0 * * 5-7', 'À meia-noite, de sexta a domingo'],
  ['0 0 * * 1,2,3,6', 'À meia-noite, de segunda a quarta-feira e aos sábados'],
  ['5 4 * * sun', 'Às 04:05, aos domingos'],
  ['0 0 1 */3 *', 'À meia-noite, no dia 1 de janeiro, abril, julho e outubro'],
  ['0 0 1-7 3 *', 'À meia-noite, do dia 1 ao 7 de março'],
  ['0 9 * 1-3 *', 'Às 09:00, todos os dias, de janeiro a março'],
  ['0 0 13 * 5', 'À meia-noite, no dia 13 de cada mês ou às sextas-feiras'],
  ['0 0 */2 * 1', 'À meia-noite, nos dias 1, 3, 5, …, 31 de cada mês, desde que seja segunda-feira'],
  ['0 0 29 2 *', 'À meia-noite, em 29 de fevereiro'],
  ['@daily', 'À meia-noite, todos os dias'],
  ['@weekly', 'À meia-noite, aos domingos'],
  ['@monthly', 'À meia-noite, no dia 1 de cada mês'],
  ['@yearly', 'À meia-noite, em 1º de janeiro'],
  ['@hourly', 'A cada hora, em ponto'],
  ['@reboot', 'Uma vez, quando o serviço cron é iniciado (normalmente na inicialização do sistema)'],
];

for (const [expr, expected] of DESCRIPTIONS) {
  test(`descreve “${expr}”`, () => {
    assert.equal(describeCron(parseCron(expr)), expected);
  });
}

const noteTexts = (expr) => analyze(parseCron(expr)).map((n) => n.text).join('\n');

test('explica a regra do OU quando dia do mês e dia da semana estão restritos', () => {
  assert.match(noteTexts('0 0 13 * 5'), /qualquer um dos dois coincide/);
  assert.match(noteTexts('0 0 */2 * 1'), /coincidam ao mesmo tempo/);
  assert.doesNotMatch(noteTexts('0 0 13 * *'), /qualquer um/);
  assert.match(noteTexts('0 0 1-31 * 1'), /todos os dias/);
  assert.equal(describeCron(parseCron('0 0 1-31 * 1')), 'À meia-noite, todos os dias');
});

test('avisa sobre datas impossíveis, anos bissextos e passos que não dividem', () => {
  assert.match(noteTexts('0 0 30 2 *'), /nunca executa: fevereiro não tem dia 30/);
  assert.match(noteTexts('0 0 31 4,6,9,11 *'), /abril, junho, setembro e novembro não têm dia 31/);
  assert.equal(analyze(parseCron('* * 31 2 *')).length, 1);
  assert.match(noteTexts('0 0 29 2 *'), /anos bissextos/);
  assert.match(noteTexts('0 0 31 * *'), /Meses sem o dia 31/);
  assert.doesNotMatch(noteTexts('0 0 */2 * *'), /Meses sem o dia 31/);
  assert.match(noteTexts('*/7 * * * *'), /passam só 4 minutos/);
  assert.match(noteTexts('0 */5 * * *'), /passam só 4 horas/);
  assert.doesNotMatch(noteTexts('*/15 * * * *'), /recomeça/);
  assert.match(noteTexts('*/90 * * * *'), /só produz o valor 0/);
  assert.match(noteTexts('* * * * *'), /GitHub Actions/);
  assert.doesNotMatch(noteTexts('*/5 * * * *'), /GitHub Actions/);
  assert.match(noteTexts('@daily'), /equivale a “0 0 \* \* \*”/);
});

test('próximas execuções: passos dentro de intervalos', () => {
  assert.deepEqual(utcRuns('10-30/5 * * * *', '2026-10-08T15:22:40Z', 4),
    ['2026-10-08T15:25', '2026-10-08T15:30', '2026-10-08T16:10', '2026-10-08T16:15']);
  assert.deepEqual(utcRuns('*/15 9-17 * * *', '2026-10-08T17:50:00Z', 2),
    ['2026-10-09T09:00', '2026-10-09T09:15']);
});

test('próximas execuções: não repete o minuto atual', () => {
  assert.deepEqual(utcRuns('30 8 * * *', '2026-10-08T08:30:00Z', 1), ['2026-10-09T08:30']);
  assert.deepEqual(utcRuns('* * * * *', '2026-10-08T08:30:59Z', 2), ['2026-10-08T08:31', '2026-10-08T08:32']);
});

test('próximas execuções: fins de mês e virada de ano', () => {
  assert.deepEqual(utcRuns('0 0 31 * *', '2026-01-31T12:00Z', 4),
    ['2026-03-31T00:00', '2026-05-31T00:00', '2026-07-31T00:00', '2026-08-31T00:00']);
  assert.deepEqual(utcRuns('0 0 30 * *', '2027-01-30T01:00Z', 2), ['2027-03-30T00:00', '2027-04-30T00:00']);
  assert.deepEqual(utcRuns('59 23 31 12 *', '2026-12-31T23:59Z', 1), ['2027-12-31T23:59']);
  assert.deepEqual(utcRuns('0 0 1 * *', '2026-12-15T00:00Z', 2), ['2027-01-01T00:00', '2027-02-01T00:00']);
});

test('próximas execuções: 29 de fevereiro só em anos bissextos', () => {
  assert.deepEqual(utcRuns('0 0 29 2 *', '2026-10-08T00:00Z', 3),
    ['2028-02-29T00:00', '2032-02-29T00:00', '2036-02-29T00:00']);
  assert.deepEqual(utcRuns('0 0 29 2 *', '2096-03-01T00:00Z', 1), ['2104-02-29T00:00']);
  assert.deepEqual(utcRuns('0 12 * 2 *', '2028-02-28T13:00Z', 2), ['2028-02-29T12:00', '2029-02-01T12:00']);
});

test('próximas execuções: regra do OU entre dia do mês e dia da semana', () => {
  // Outubro de 2026: dia 13 é terça-feira; sextas-feiras são 9, 16, 23 e 30.
  assert.deepEqual(utcRuns('0 0 13 * 5', '2026-10-08T12:00Z', 4),
    ['2026-10-09T00:00', '2026-10-13T00:00', '2026-10-16T00:00', '2026-10-23T00:00']);
  // Com o dia do mês começando em "*", vale o E: dias ímpares que caem na segunda-feira.
  assert.deepEqual(utcRuns('0 0 */2 * 1', '2026-10-01T12:00Z', 3),
    ['2026-10-05T00:00', '2026-10-19T00:00', '2026-11-09T00:00']);
  // Dia da semana começando em "*": dias 1 a 7 que sejam domingo, terça, quinta ou sábado.
  assert.deepEqual(utcRuns('0 0 1-7 * */2', '2026-10-08T00:00Z', 3),
    ['2026-11-01T00:00', '2026-11-03T00:00', '2026-11-05T00:00']);
});

test('próximas execuções: domingo como 7 e nomes', () => {
  assert.deepEqual(utcRuns('0 9 * * 7', '2026-10-08T00:00Z', 2), ['2026-10-11T09:00', '2026-10-18T09:00']);
  assert.deepEqual(utcRuns('0 9 * jan mon', '2026-10-08T00:00Z', 2), ['2027-01-04T09:00', '2027-01-11T09:00']);
});

test('próximas execuções: atalhos e expressão impossível', () => {
  assert.deepEqual(utcRuns('@weekly', '2026-10-08T00:00Z', 2), ['2026-10-11T00:00', '2026-10-18T00:00']);
  assert.deepEqual(utcRuns('@yearly', '2026-10-08T00:00Z', 1), ['2027-01-01T00:00']);
  assert.deepEqual(utcRuns('0 0 30 2 *', '2026-10-08T00:00Z', 3), []);
});

test('próximas execuções no horário local ignoram horários que não existem', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/Sao_Paulo';
  try {
    // Em 4/11/2018 o horário de verão começou à meia-noite: 00:00 não existiu.
    const runs = nextRuns(parseCron('0 0 * * *'), new Date(2018, 10, 2, 12, 0), 3);
    assert.deepEqual(runs.map((d) => formatRun(d)), [
      'sáb, 03/11/2018 às 00:00', 'seg, 05/11/2018 às 00:00', 'ter, 06/11/2018 às 00:00',
    ]);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('calcula pulando campos, sem varrer minuto a minuto', () => {
  const start = performance.now();
  const runs = nextRuns(parseCron('0 0 29 2 */7'), new Date(Date.UTC(2026, 0, 1)), 10, { utc: true });
  assert.equal(runs.length, 10);
  assert.ok(runs.every((d) => d.getUTCDay() === 0 && d.getUTCDate() === 29));
  assert.ok(performance.now() - start < 1000);
});

test('formata datas e tempo relativo', () => {
  assert.equal(formatRun(new Date(Date.UTC(2026, 9, 9, 8, 5)), true), 'sex, 09/10/2026 às 08:05');
  assert.equal(formatRelative(20 * 1000), 'em menos de 1 minuto');
  assert.equal(formatRelative(45 * 60000), 'em 45 min');
  assert.equal(formatRelative(125 * 60000), 'em 2 h 5 min');
  assert.equal(formatRelative(3 * 3600000), 'em 3 h');
  assert.equal(formatRelative(26 * 3600000), 'em 1 dia e 2 h');
  assert.equal(formatRelative(40 * 86400000), 'em 40 dias');
});

test('resume cada campo', () => {
  const p = parseCron('*/15 9-17 * jan,jul 1-5');
  assert.deepEqual(p.fields.map((f, i) => summarizeField(f, i).text), [
    '0, 15, 30 e 45', '9 a 17', 'todos (1 a 31)', 'janeiro e julho',
    'segunda-feira, terça-feira, quarta-feira, quinta-feira e sexta-feira',
  ]);
});

test('montador gera expressões a partir dos controles', () => {
  assert.equal(compressValues([5, 1, 2, 3, 10, 11]), '1-3,5,10,11');
  assert.equal(buildExpression([
    { mode: 'step', step: 15 }, { mode: 'range', from: 9, to: 17 }, { mode: 'all' }, { mode: 'all' },
    { mode: 'range', from: 1, to: 5 },
  ]), '*/15 9-17 * * 1-5');
  assert.equal(buildExpression([
    { mode: 'list', values: [30] }, { mode: 'list', values: [8, 18] }, { mode: 'list', values: [1, 15] },
    { mode: 'step', step: 3 }, { mode: 'list', values: [0, 6] },
  ]), '30 8,18 1,15 */3 0,6');
  assert.equal(buildExpression([
    { mode: 'step', step: 10, start: 5 }, { mode: 'range', from: 8, to: 18, step: 2 }, { mode: 'all' },
    { mode: 'all' }, { mode: 'all' },
  ]), '5-59/10 8-18/2 * * *');
  assert.throws(() => buildExpression([{ mode: 'list', values: [] }, { mode: 'all' }, { mode: 'all' }, { mode: 'all' }, { mode: 'all' }]),
    /escolha pelo menos um valor/);
  assert.throws(() => buildExpression([{ mode: 'range', from: 9, to: 2 }, { mode: 'all' }, { mode: 'all' }, { mode: 'all' }, { mode: 'all' }]),
    /início do intervalo/);
});

test('montador reproduz a expressão carregada quando possível', () => {
  for (const expr of ['*/15 9-17 * * 1-5', '30 8 1,15 */3 0,6', '5/10 8-18/2 * jan-mar *', '@weekly']) {
    const p = parseCron(expr);
    const rebuilt = parseCron(buildExpression(p.fields.map((f, i) => specFromField(f, i))));
    assert.ok(sameSchedule(p, rebuilt), expr);
  }
  const lossy = parseCron('0 0 1 * */2');
  const rebuilt = parseCron(buildExpression(lossy.fields.map((f, i) => specFromField(f, i))));
  assert.equal(sameSchedule(lossy, rebuilt), false);
});
