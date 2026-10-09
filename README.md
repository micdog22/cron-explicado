# Cron Explicado: entenda e monte expressões cron em português (HTML + JS)

Cole uma expressão cron e veja, em português claro, quando ela roda, o que cada campo significa e as próximas 10 execuções no seu horário. Também dá para montar a expressão clicando, sem decorar a sintaxe. Serve para quem agenda tarefas no crontab do Linux, no GitHub Actions ou em qualquer sistema que use o formato de 5 campos.

**Acesse online:** https://micdog22.github.io/cron-explicado/

## Recursos

- Os 5 campos do cron padrão (minuto, hora, dia do mês, mês e dia da semana) com listas, intervalos e passos (`*/15`, `10-30/5`, `5/20`), nomes em inglês (`JAN` a `DEC`, `SUN` a `SAT`, com maiúsculas ou minúsculas) e domingo como `0` ou `7`.
- Atalhos `@yearly`, `@annually`, `@monthly`, `@weekly`, `@daily`, `@midnight`, `@hourly` e `@reboot`.
- Descrição natural: `30 8 * * 1-5` vira “Às 08:30, de segunda a sexta-feira”.
- Regra do Vixie cron para dia do mês × dia da semana, com aviso quando ela muda o resultado.
- Próximas 10 execuções no fuso do navegador ou em UTC (como o GitHub Actions calcula).
- Alertas: datas que nunca acontecem (30 de fevereiro), 29 de fevereiro só em anos bissextos, meses sem dia 31, passos que não dividem a hora, intervalo mínimo do GitHub Actions.
- Erros em português que apontam o campo com problema e reconhecem sintaxes de outras ferramentas (`?`, `L`, `W`, `#`, 6 campos com segundos).
- Montador visual, galeria de exemplos e botão para copiar um link com a expressão.
- Aceita uma linha inteira de crontab: o que vem depois dos 5 campos aparece como comando.

## Como usar

Digite ou cole a expressão no campo principal; a explicação é atualizada enquanto você digita.

| Expressão | Descrição |
|---|---|
| `*/15 9-17 * * *` | A cada 15 minutos, das 09:00 às 17:59 |
| `0 0 1,15 * *` | À meia-noite, nos dias 1 e 15 de cada mês |
| `0 12 * 1 0` | Ao meio-dia, aos domingos, em janeiro |
| `0 */6 * * *` | Às 00:00, 06:00, 12:00 e 18:00, todos os dias |
| `0 0 13 * 5` | À meia-noite, no dia 13 de cada mês ou às sextas-feiras |
| `@monthly` | À meia-noite, no dia 1 de cada mês |

O botão **Copiar link** gera um endereço que já abre com a expressão, por exemplo `https://micdog22.github.io/cron-explicado/#0%209%20*%20*%201-5`.

## Como rodar localmente

Os módulos ES não carregam via `file://`, então sirva a pasta:

```bash
python3 -m http.server 8000
```

e abra http://localhost:8000.

## Testes

```bash
npm test
```

(ou `node --test`; não há dependências para instalar)

## Como funciona

- **Dia do mês × dia da semana:** como no Vixie cron (e no cronie), quando os dois campos estão restritos a execução acontece se **qualquer um** coincidir. Um campo conta como livre quando começa com `*`; nesse caso os dois precisam coincidir. Por isso `0 0 13 * 5` roda em todo dia 13 e em toda sexta-feira, enquanto `0 0 */2 * 1` só roda nos dias ímpares que caem numa segunda-feira.
- **Próximas execuções:** o cálculo percorre só os valores permitidos de cada campo (ano → mês → dia → hora → minuto), sem testar minuto a minuto, e procura até 400 anos à frente (um ciclo completo do calendário gregoriano). No horário local, horários que não existem por causa do horário de verão são ignorados.
- **Fuso horário:** o crontab do Linux usa o fuso do servidor; o `schedule` do GitHub Actions usa sempre UTC. Para rodar às 08:00 de Brasília (UTC-3) no GitHub Actions, use `0 11 * * *`.

## Contribuindo

Issues e pull requests são bem-vindos.

## Licença

MIT. Veja [LICENSE](LICENSE).
