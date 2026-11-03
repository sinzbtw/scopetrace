# Публикация в npm

Наше имя: **@nesinz/scopetrace**. Команда CLI остаётся **scopetrace**. Пакет npm без scope принадлежит другому издателю; этот репозиторий не должен публиковаться под чужим именем.

## Граница активации

Код и GitHub-пайплайн готовы к npm, но владелец npm-аккаунта должен зарегистрировать пакет и настроить доверие. Успешный dry-run не означает публикацию. До подтверждения владельца и Trusted Publisher переменная NPM_PUBLISH_ENABLED остаётся false. Старый GitHub-тег v0.4.0 не меняется; обновление упаковки готовит 0.4.1.

## Устройство workflow

[npm-publish.yml](https://github.com/sinzbtw/scopetrace/blob/main/.github/workflows/npm-publish.yml) запускается при публикации стабильного GitHub Release либо вручную. Ручной запуск по умолчанию выполняет только dry-run, без публикации и OIDC-job. Тег vX.Y.Z должен совпадать с package.json, lockfile и проверяемым коммитом, который должен входить в историю main. Для настоящей публикации дополнительно нужны стабильный опубликованный GitHub Release, ожидаемый репозиторий и NPM_PUBLISH_ENABLED=true.

Шесть job проверяют Windows/Linux и Node.js 22/24/26 без OIDC-доступа. Отдельная job с npm 12.2.1 выполняет полный аудит зависимостей, сборку, упаковку без lifecycle-скриптов, изолированную установку точного архива, проверку всех провайдеров, JSON/SARIF и confidence, CLI/gate, API/типов, состава пакета и ссылок документации, а также npm publish --dry-run. В Actions artifact передаются только архив, манифест и контрольные суммы.

Только финальная job получает id-token: write в GitHub environment npm. Она не устанавливает зависимости проекта и не запускает его тесты/сборочные lifecycle-скрипты. Загружается artifact своего запуска, проверяются source commit и SHA-256/SHA-512, версия/тег и состояние реестра; публикуется точный архив с --ignore-scripts и --provenance. Сбой registry блокирует публикацию: только HTTP 404 означает отсутствие пакета. Иная сборка уже занятой версии отклоняется, идентичная допускает безопасный повтор. latest нельзя откатить на старую стабильную версию. Публикации идут последовательно и не отменяются посреди выполнения.

NPM_TOKEN, NODE_AUTH_TOKEN, личные access tokens и npm-секреты в Actions не нужны. Нет pull_request_target, workflow_call и self-hosted publishing runner. Кеши релизной сборки отключены. Environment npm разрешает main и теги v*. Обычный CI остаётся с правами чтения.

## Однократная настройка владельцем

1. Создайте бесплатный npm-аккаунт nesinz, подтвердите email и включите 2FA через passkey/WebAuthn. Recovery codes сохраните у себя. Публичный scoped-пакет бесплатен; платный план не нужен.
2. У ещё не зарегистрированного пакета нет страницы Settings. Сначала опубликуйте полностью проверенный архив через интерактивную npm-сессию с подтверждением в браузере. Automation token создавать не нужно. Для Node.js 22.22.2+ либо актуального поддерживаемого 24/26 выполните из каталога проекта:

~~~powershell
npx --yes npm@12.2.1 login --auth-type=web --registry=https://registry.npmjs.org/
npx --yes npm@12.2.1 whoami --registry=https://registry.npmjs.org/
# Результат whoami должен быть nesinz. Используйте архив из package:check.
npx --yes npm@12.2.1 publish ./work/npm/nesinz-scopetrace-0.4.1.tgz --access public --ignore-scripts --registry=https://registry.npmjs.org/
~~~

Если проверенный архив ещё не подготовлен, сначала выполните npm run check и npm run package:check. Сверьте work/npm/CHECKSUMS.sha256. Первая публикация — интерактивная операция владельца, а не подтверждение работы OIDC/provenance. Следующие версии публикует workflow. npm также поддерживает первичную регистрацию через staged publish, но одну версию нельзя одновременно держать в staging и публиковать напрямую; не обходите проверки и не публикуйте пустой пакет анализатора.

3. Непосредственно перед следующим стабильным релизом в Settings → Trusted publishing пакета добавьте GitHub Actions:

| Поле | Точное значение |
| --- | --- |
| Organization or user | sinzbtw |
| Repository | scopetrace |
| Workflow filename | npm-publish.yml |
| Environment name | npm |
| Allowed action | Allow npm publish |

Указывается только имя файла с расширением, без .github/workflows/. Разрешите именно прямой npm publish: stage-only недостаточно. GitHub-аккаунт sinzbtw и npm-аккаунт nesinz различаются — это ожидаемо. Альтернатива настройке через сайт, с интерактивным подтверждением владельца:

~~~sh
npx --yes npm@12.2.1 trust github @nesinz/scopetrace --file npm-publish.yml --repo sinzbtw/scopetrace --env npm --allow-publish
~~~

4. В npm Settings → Publishing access выберите **Require two-factor authentication and disallow tokens**. OIDC продолжит работать. Не переносите локальную сессию в GitHub Secrets. После однократной настройки выйдите из локальной npm-сессии.
5. Подтвердите правильность Trusted Publisher. Установите GitHub repository variable NPM_PUBLISH_ENABLED=true. Это флаг, а не секрет. До включения настоящая публикация останавливается. Первую успешную OIDC-публикацию нужно выполнить в течение текущего двухдневного окна npm; если связь истечёт, пересоздайте её непосредственно перед новой версией.

## Новые версии

Согласованно обновите package.json/package-lock.json, src/engine/shared.ts, проверки версии, README RU/EN и CHANGELOG. Выполните npm run check, npm audit --audit-level=moderate и npm run package:check. По политике этого проекта коммит отправляется прямо в main. Поставьте соответствующий стабильный тег vX.Y.Z на проверенный коммит и опубликуйте GitHub Release. Workflow самостоятельно повторит проверки перед npm publish.

Не передвигайте старые теги и не переиспользуйте версии npm. После bootstrap следующая автоматическая публикация должна иметь новую версию. Если workflow упал после реальной публикации, повтор допустим только при совпадении содержимого. Не удаляйте npm-версию ради обхода проверки. Сам GitHub Release не доказывает публикацию npm: проверяйте результат workflow, версию/integrity в реестре и provenance на странице пакета.

Для dry-run запустите workflow на main с publish=false и пустым tag. Настоящий ручной запуск требует publish=true и существующий стабильный release tag; сам workflow нужно запускать на этом теге, а не на main. GITHUB_SHA должен совпадать с собранным коммитом, чтобы provenance не указывал другой исходный код. Действуют те же защиты. Prerelease-каналы не включены.

## Официальные источники (проверено 2026-11-03)

- [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
- [Provenance](https://docs.npmjs.com/generating-provenance-statements/)
- [Команда npm trust](https://docs.npmjs.com/cli/v12/commands/npm-trust/)
- [Staged publishing](https://docs.npmjs.com/staged-publishing/)
- [Настройка 2FA](https://docs.npmjs.com/configuring-two-factor-authentication/)
