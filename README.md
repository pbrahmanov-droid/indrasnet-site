# indrasnet.eu — сайт IndrasNet

Статический сайт, публикуется через GitHub Pages из ветки `main`, корень репозитория.

- `index.html` — главная IndrasNet
- `luman-links-beta.html` — бета Luman Links (скачивание APK)
- `assets/` — картинки

## Выпуск новой сборки Luman Links

Страницу править не нужно: кнопка «Скачать APK», версия, размер, дата,
SHA-256 и список изменений берутся из последнего выпуска (Release) с тегом `ll-…`.

1. Собрать APK (`build:release` в luman-links-app-v2, versionCode +1, тот же ключ).
2. Скопировать `app-release.apk` под именем `luman-links-<версия>-b<versionCode>.apk`.
3. Создать выпуск:

   gh release create ll-v<версия>-b<versionCode> luman-links-<версия>-b<versionCode>.apk --repo pbrahmanov-droid/indrasnet-site --title "Luman Links <версия> (сборка <versionCode>)" --notes-file changes.md

   `changes.md` — список изменений, по строке на пункт, каждая строка начинается с «- ».

## Настройки страницы беты

В конце `luman-links-beta.html`: `RELEASES_REPO` (при переносе репозитория),
`TELEGRAM_URL` (ссылка на группу беты).
