# Релизы в npm

ScopeTrace публикуется под именем **@nesinz/scopetrace**. Установленная команда — **scopetrace**. Здесь описан выпуск версий для сопровождающих проекта; установка описана в [README](../README.ru.md#установка).

## Порядок выпуска

1. Обновите версию пакета, lockfile, константы версии инструмента и проверки версии. Подготовьте CHANGELOG и оба README для релиза.
2. Выполните проверки из корня репозитория:

~~~sh
npm ci --ignore-scripts
npm run check
npm run smoke
npm audit --audit-level=moderate
npm run package:check
~~~

3. Закоммитьте проверенные изменения. Создайте стабильный тег vX.Y.Z на этом коммите в истории main и опубликуйте соответствующий GitHub Release.
4. Проверьте [workflow публикации npm](https://github.com/sinzbtw/scopetrace/actions/workflows/npm-publish.yml), версию и latest в реестре, целостность архива и provenance.

Тег, package.json, package-lock.json и исходный коммит должны соответствовать друг другу. Публикация prerelease не включена. Существующие теги и версии npm сохраняют идентичность выпущенной сборки.

## Автоматические проверки и публикация

[npm-publish.yml](https://github.com/sinzbtw/scopetrace/blob/main/.github/workflows/npm-publish.yml) запускается при публикации GitHub Release и вручную. Для публикации нужны ожидаемый репозиторий, существующий стабильный релиз и NPM_PUBLISH_ENABLED=true.

Шесть проверок выполняются на Windows/Linux с Node.js 22, 24 и 26. Этап упаковки проверяет зависимости, собирает CLI и устанавливает точный архив в изолированный каталог. Проверяются провайдеры, схемы отчётов, SARIF, сравнение прав, пороги CLI, публичные API/типы, состав пакета и ссылки документации. Архив, манифест исходного коммита и контрольные суммы передаются в одном Actions artifact.

Только финальный этап получает id-token: write в environment npm. Он не устанавливает зависимости проекта, проверяет исходный коммит и SHA-256/SHA-512 артефакта, затем публикует этот архив через GitHub OIDC с --ignore-scripts и --provenance. Секрет с npm-токеном не требуется. Запуски выполняются последовательно; публикация не отменяется посреди выполнения.

## Конфигурация издателя

Trusted Publisher репозитория использует следующие значения:

| Параметр | Значение |
| --- | --- |
| Пакет npm | @nesinz/scopetrace |
| Репозиторий GitHub | sinzbtw/scopetrace |
| Имя workflow | npm-publish.yml |
| GitHub environment | npm |
| Разрешённое действие | Allow npm publish |
| Переменная репозитория | NPM_PUBLISH_ENABLED=true |

Для пакета npm включены двухфакторная аутентификация и запрет публикации по токенам. Trusted Publishing аутентифицирует workflow через OIDC. GitHub environment допускает main и теги v*; этапы тестирования и сборки не имеют OIDC-прав. Настройки издателя и environment сопровождаются отдельно от файла workflow. Значение NPM_PUBLISH_ENABLED=false отключает последующие публикации в реестр.

## Проверочный запуск и повтор

Ручной запуск на main с publish=false и пустым tag проверяет пакет без публикации. Ручная публикация требует publish=true, соответствующего стабильного релиза и запуска workflow на теге этого релиза, чтобы provenance указывал на собранный коммит.

Обработка версии реестром может занимать несколько минут. Workflow ожидает появления версии, сверяет целостность и проверяет latest. Сбой проверки после публикации допускает повтор для того же релиза и идентичного архива. Иное содержимое существующей версии отклоняется; dry-run повторной версии в npm 12 пропускается только после точного совпадения integrity в реестре. Старая версия не может переместить latest назад.

GitHub Release и успешный dry-run сами по себе не подтверждают публикацию в реестре. Её результат подтверждают этап publish и метаданные npm.

## Источники

- [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm provenance](https://docs.npmjs.com/generating-provenance-statements/)
- [Настройка 2FA](https://docs.npmjs.com/configuring-two-factor-authentication/)
