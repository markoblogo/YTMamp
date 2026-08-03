🎉 YTMamp v0.3.3

Вышла новая версия с акцентом на интеграции и устойчивость локального API.

## Что нового в v0.3.3
- Добавлены и стабилизированы локальные integration API: `/status`, `/current-track`, `/events`, `/obs`.
- Введена согласованная API-версия (`x-ytmamp-api-version`) и hardened response headers.
- Реализованы CORS/origin allowlist и минимальный payload для OBS-оверлея.
- Добавлен Last.fm скробблинг с retry queue и деградацией при ошибках 429/5xx.
- Усилены CI smoke-контракты: матрица `/status` и `/current-track` для всех статусных кодов, + step summary в артефактах.
- Windows CI-падение на smoke фиксировано (стабильный запуск `npm test` через shell-режим).

## Что НЕ входит в релиз
- Discord Rich Presence и глобальные media/hotkeys/profiles/tray actions переносимы в следующий цикл (вне скоупа текущего релиза).

## Ссылки
- Release assets: https://github.com/markoblogo/YTMamp/releases/tag/v0.3.3
- Docs: https://github.com/markoblogo/YTMamp/blob/main/docs/integration-api.md
- Changelog: https://github.com/markoblogo/YTMamp/blob/main/CHANGELOG.md

## Как скачать
- macOS: `YTMamp-0.3.3-mac.dmg`, `YTMamp-0.3.3-mac.zip`
- Windows: `YTMamp-0.3.3-win.exe`, `YTMamp-0.3.3-win.zip`
- Linux: `YTMamp-0.3.3-linux.AppImage`, `YTMamp-0.3.3-linux.deb`
