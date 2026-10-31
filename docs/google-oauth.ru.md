# Google OAuth 2.0: Gmail, Drive и Calendar

В ScopeTrace 0.3 добавлен отдельный `provider: "google-oauth"`. Он не смешивается с GitHub OAuth и GitHub Apps. Сканирование локальное, без сети и токенов. Установка Google SDK в проверяемом проекте не нужна для AST-распознавания.

## Запуск и конфигурация

```sh
scopetrace init --provider google-oauth
scopetrace rules --provider google-oauth
# Отредактируйте конфигурацию перед проверкой.
scopetrace scan --format json
scopetrace scan --fail-on high
```

Используйте собранные исходники или архив с реализацией 0.3: старые релизы не поддерживают этот провайдер. Пакет в реестре npm по-прежнему не опубликован.

```json
{
  "provider": "google-oauth",
  "declaredScopes": [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/calendar.events.readonly"
  ],
  "include": ["src/**/*.{js,jsx,ts,tsx}"],
  "exclude": ["**/*.test.*", "**/*.spec.*"],
  "googleContext": {
    "driveAccess": "unknown",
    "calendarResources": "unknown",
    "calendarData": "unknown"
  }
}
```

Контекст — ваше явное утверждение для всех соответствующих вызовов в запуске:

- driveAccess: unknown, app-authorized (созданные приложением/выбранные пользователем файлы), app-data.
- calendarResources: unknown, owned, app-created, public.
- calendarData: unknown, events, availability.

Для смешанного доступа используйте отдельные проверки. Контекст не выдаёт прав и не доказывает владение. GitHub-поля tokenType, declaredPermissions и repositoryVisibility здесь не заменяют Google-настройки.

## Обнаружение вызовов

Поддерживаются статические URL глобального fetch и доказуемые импорты Node SDK:

```ts
import { google as g } from 'googleapis';
const gmail = g.gmail({ version: 'v1', auth: oauthClient });
gmail.users.messages.send({ userId: 'me', requestBody: { raw: message } });
const drive = g.drive('v3');
drive.files.get({ fileId: selectedFile, alt: 'media' });
const calendar = g.calendar('v3');
calendar.events.list({ calendarId: 'primary' });

fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10');
```

Распознаются ESM-алиасы, namespace/default импорты модуля, CommonJS-деструктуризация, поддерживаемые const-алиасы методов и фабрики @googleapis/gmail, @googleapis/drive, @googleapis/calendar. Версии: Gmail v1, Drive v3, Calendar v3.

Глобальные google.options, неподдерживаемые опции, признаки API-key авторизации, динамические URL и распознаваемые собственные клиенты дают unknown. Объекты параметров из переменных, spreads, вычисляемые ключи и getters не выполняются и не считаются безопасно разрешёнными. Некоторые обёртки, browser gapi, Apps Script и межфайловые фабрики вообще могут не распознаться.

## Правила и условия доступа

[Версионированный каталог](../rules/google-oauth.json) содержит 22 метода: HTTP-маршруты, SDK-пути, точные альтернативы scopes, условия, источники и дату проверки. Списки scopes получены из официальных Discovery-ревизий, проверенных 31 октября 2026 года. Наличие scope в Discovery не отменяет условий его применения.

Gmail: список/чтение/отправка/изменение/перемещение в корзину/окончательное удаление сообщений, список/создание меток и профиль. Gmail metadata не разрешает full/raw-тела писем и поиск через q. Динамические optional q/format остаются неопределёнными. Gmail modify недостаточен для немедленного окончательного удаления: этой операции нужен полный mail scope.

Drive: список/чтение/создание/изменение/удаление файлов. Metadata scopes не разрешают скачивать или загружать содержимое. Drive file ограничен ресурсами и не равнозначен drive или drive.readonly. Создание нового файла может использовать drive.file; для существующих нужны подтверждённые условия доступа. App-data и другие ограниченные scopes сохраняют свои условия. Категория appfolder известна, но эквивалентность его авторизации appdata не предполагается.

Calendar: список/чтение/создание/изменение/удаление событий, чтение списка календарей, метаданных календаря и free/busy. Readonly не разрешает запись. Scopes для owned/app-created/public/availability требуют соответствующего контекста. Публичный доступ или API keys не превращаются в выдуманную нехватку OAuth-прав.

Нормализация только убирает дубликаты и сортирует известные URI. Вложенность не угадывается по префиксам; несопоставимые scopes не объединяются. Более узкие варианты проверяются для каждой соответствующей моделируемой операции. Это альтернативы, а не совет запросить все сразу. Unknown-вызовы и поведение приложения требуют отдельного ревью.

## Sensitive и restricted scopes

Для каждого известного объявленного scope есть запись scopeAssessments с датой и источником. Категории Gmail и Drive взяты из официальных руководств, например:

- gmail.send: sensitive.
- Полный mail, gmail.readonly и широкий Drive-доступ: restricted.
- gmail.labels и drive.file: non_sensitive.

Для Calendar и других URI, чья категория не подтверждена проверенными официальными руководствами, используется unknown. Они не считаются автоматически безопасными/non-sensitive. Актуальную категорию нужно проверить в настройках consent.

Sensitive/restricted не означает уязвимость или доказанную необходимость verification/security assessment именно для вашего приложения. Важны аудитория, публикация, обработка данных, исключения и текущая политика. ScopeTrace не запрашивает настройки consent и не принимает решения о соответствии требованиям. Одна категория не блокирует CI.

## Отчёты и безопасность

Google JSON использует [schemaVersion 3.0.0](../schemas/google-oauth-report.schema.json). GitHub-схемы 1.0.0/2.0.0 сохранены. Отчёт содержит известные декларации, категории scopes, условные альтернативы, стабильные ID/доказательства и suggestedScopes с низкой уверенностью.

Неизвестные значения scopes скрываются и могут не позволить уверенно установить недостаточность прав. Login scopes openid/email/profile вне этой ресурсной модели; их ненужность не доказывается. Unknown и проверка категорий не блокируют CI: порог fail-on применяется к достаточно уверенным insufficient-находкам.

Код не выполняется, токены не читаются, сетевых запросов при scan нет. Сохраняются только категориальные факты: формат ответа, наличие поискового параметра и намерение работать с метаданными/содержимым. Адреса, идентификаторы пользователей/файлов/календарей, поисковые значения, тела, заголовки, API keys и auth-строки в отчёт не попадают. Фактические grants, incremental consent, идентичность токенов, API-key/public авторизация и service-account delegation не проверяются.

## Источники

- [Категории Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Категории Drive и доступ к отдельным файлам](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth)
- [Форматы Gmail](https://developers.google.com/workspace/gmail/api/reference/rest/v1/Format)
- [Официальный Node SDK](https://github.com/googleapis/google-api-nodejs-client)

Документация методов и Discovery URL/ревизии сохранены в каталоге. Загрузка публичной документации при разработке отделена от полностью локального scan.
