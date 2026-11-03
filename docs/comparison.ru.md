# Сравнение прав между ветками и Pull Requests

В ScopeTrace 0.5.0 команда compare сопоставляет закоммиченные **объявления прав в JSON-конфигурации ScopeTrace** для github-oauth, github-app и google-oauth. Изменения API-вызовов, произвольных OAuth-строк и provider manifests этой командой не сканируются; для поддерживаемых исходников остаётся scan.

## Команды

~~~sh
# Непосредственно сравнить вершины веток; head по умолчанию HEAD.
scopetrace compare --base main --head feature
scopetrace compare --base v0.4.2 --head HEAD --format json --output changes.json
# Изменения PR от единственного общего предка.
scopetrace compare --base origin/main --head feature --merge-base --format markdown
# Политика ревью: повышение прав и неопределённые сравнения блокируют проверку.
scopetrace compare --base origin/main --head HEAD --merge-base --fail-on medium --fail-on-unknown
~~~

--config config/permissions.json выбирает один файл относительно текущего каталога приложения; source.configPath в отчёте указан относительно корня Git. В обоих снимках читается один путь. Незакоммиченные и staged-файлы игнорируются. Для нескольких конфигураций запускайте отдельные сравнения с разными выходными файлами.

Для номера GitHub PR сначала явно получите данные, затем используйте локальный ref:

~~~sh
git fetch origin pull/123/head:refs/pull/123/head
scopetrace compare --base origin/main --pr 123 --format markdown
~~~

--pr всегда использует merge-base и несовместим с --head. Команда не обращается к GitHub и ничего не загружает. Нужные commits/refs и история должны быть доступны локально. Отсутствующие объекты shallow/partial clone дают код 2. Несколько равноправных merge bases отклоняются, произвольный предок не выбирается. Git должен поддерживать --no-lazy-fetch; старый Git безопасно завершит проверку с ошибкой и требует обновления. Обычный scan по-прежнему не требует Git.

## Изменения

| Kind | Значение |
| --- | --- |
| added | Новая документированная привилегия, не покрытая прежними моделируемыми правами |
| expanded | Более широкое право покрывает прежние узкие права; включая read → write GitHub Apps |
| reduced | Широкое объявление заменено более узкими документированными правами |
| removed | Старое объявление отсутствует и не покрывается новым документированным широким правом |
| equivalent | Изменились только избыточные объявления, моделируемый доступ эквивалентен |
| unknown | Неподдерживаемые scopes, смена модели/контекста или отсутствие файла требуют ревью |

Отдельно сохраняются точные распознанные добавления и удаления объявлений. Нормализация не скрывает правки; перестановки и дубликаты не создают изменений. Несравнимые замены могут одновременно добавлять и удалять привилегии: итоговое «снижение» не угадывается. Удаление scope не доказывает отзыв токена, а добавление/расширение описывает объявление, не фактическую успешную авторизацию.

GitHub OAuth использует прежнюю иерархию каталога: user:email → user — расширение, а добавление user:email при сохранённом user — equivalent. У GitHub Apps read/write сравниваются только для одного domain/key. Смена provider или token kind не упорядочивается как повышение/снижение.

Для Google используется отдельный [каталог явных отношений](../rules/google-scope-relations.json), проверенный 2026-11-04 по описаниям Gmail/Drive/Calendar. В нём заданы включения целых scopes; условные предложения сужения из scan не задают эту иерархию. Префикс URI не доказывает включение. Отношения дополнительно проверяются по официальной Discovery-матрице методов/scopes. calendar.events не полностью покрывает events.owned (контрпример — colors.get), поэтому такая замена остаётся смешанным добавлением/удалением. Документированные направления drive → drive.file и calendar → calendar.app.created описывают строгое сужение охвата ресурсов, а не эквивалентность или доказательство авторизации конкретного файла/календаря. drive.appdata остаётся отдельным правом. Sensitive/restricted/unknown сохраняются отдельно от confidence и не доказывают обязанности verification.

Известные повышения имеют high confidence, при появлении нового файла — medium. Расширение, новое App write и добавление restricted Google scope имеют high severity; обычное добавление — medium. Изменение metadata read GitHub Apps остаётся заметкой для ревью, поскольку это право может быть неявным. Снижение/удаление/эквивалентность информационные. Неподдерживаемые объявления переводят семантические изменения в unknown/low, неизвестные значения скрываются. Изменение selectors/resource assertions тоже даёт заметку для ревью, но не подавляет независимо известное расширение scopes.

## Отчёты, пороги и API

Форматы: text, JSON и Markdown. Независимый JSON-контракт: kind=permission-diff, schemaVersion=1.0.0 ([схема](../schemas/comparison-report.schema.json)). В нём есть snapshots base/head, правки объявлений, семантика изменений, confidence, предупреждения escalation, сводка, ограничения и SHA выбранных commits. Прежние схемы scan 1.0.0/2.0.0/3.0.0 и SARIF 2.1.0 не меняются. В этой версии compare не экспортирует SARIF.

Файл создаётся эксклюзивно. Код 0 — сравнение выполнено; 1 — сработало явно заданное требование ревью; 2 — ошибка конфигурации/ref/Git/истории. Полный отчёт записывается до кода 1.

--fail-on severity блокирует известные added/expanded не ниже порога с medium/high confidence. Отдельный --fail-on-unknown блокирует analysis.complete=false, даже без --fail-on. В PR-примере включены оба: неизвестный scope или смена модели не позволяют обойти ревью. По умолчанию пороги выключены. Семантика прежнего scan не меняется.

~~~ts
import { configSchema, comparePermissions, compareGit, renderComparison, shouldFailComparison } from '@nesinz/scopetrace';
const before = configSchema.parse({ provider: 'github-oauth', declaredScopes: ['user:email'] });
const after = configSchema.parse({ provider: 'github-oauth', declaredScopes: ['user'] });
const report = comparePermissions(before, after);
const markdown = renderComparison(report, 'markdown');
const gate = shouldFailComparison(report, 'medium', true);
const committed = await compareGit(process.cwd(), { base: 'origin/main', head: 'HEAD', mergeBase: true });
~~~

null означает отсутствие отслеживаемого файла, а не пустые реальные права. Отсутствие с обеих сторон — ошибка. Удалённая head-конфигурация всегда требует ревью и не доказывает безопасного сужения доступа.

## Pull Requests

Скопируйте [github-permission-diff.yml](../examples/github-permission-diff.yml) в .github/workflows приложения. Workflow с read-only pull_request получает данные приложения с полной историей, отдельно собирает анализатор на проверенном полном SHA, сравнивает фактические base/head SHA события от merge-base, прикладывает Markdown к job summary проверки и выдаёт warning/падение при повышениях либо unknown. Зависимости и скрипты приложения не запускаются. Merge checkout используется только как источник Git-объектов, его файлы не становятся сравниваемыми base/head.

Достаточно contents: read; не нужны PR write-токен, npm-секрет, pull_request_target и bot comment. Fork PR работают с тем же read-only событием с учётом настроек одобрения репозитория. Отсутствующие/устаревшие объекты события дают ошибку: получите правильную историю и повторите, не подменяйте refs. Обновления SHA инструмента требуют ревью. Сам ScopeTrace использует [тот же workflow](https://github.com/sinzbtw/scopetrace/blob/main/.github/workflows/permission-diff.yml) с явной .github-конфигурацией; доступен ручной запуск для проверки.

## Локальная безопасность

Git запускается абсолютным путём вне проекта, через массив аргументов, с лимитами времени/вывода и отключёнными lazy fetch, replace refs, pager и fsmonitor. Унаследованные GIT_* overrides исключаются. Читаются только выбранные обычные JSON blobs до 64 KiB. Ссылки, submodules, trees и некорректные JSON/config отклоняются. compare не делает checkout/worktree, не распаковывает архивы, не запускает hooks/filters/код проекта и не обращается к сети. В отчёте — известные объявления и относительный путь конфигурации; raw JSON/исходники, неизвестные scopes, абсолютный корень и произвольный Git stderr не добавляются. Нужны стабильная локальная база объектов и доверенная установка Git.

Источники: [Git diff/merge-base](https://git-scm.com/docs/git-diff), [неоднозначные merge bases](https://git-scm.com/docs/git-merge-base), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [PR-события GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).
