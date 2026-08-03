# Next Release Plan: YTMamp (Next Iteration)

Дата документа: 2026-08-03

## Цель релиза
Выпустить платформенный шаг: core-договор + безопасность bridge + событийная шина + плагинная платформа MVP.

## Sprint 1 — Фундамент

### S1-01 Core contracts: выделить shared protocol/events/state в core-пакет
- `Epic`: Core Platform
- `Story points`: 8
- `labels`: `epic/core`, `refactor`, `type-safety`
- `assignee`: `you`
- `depends on`: —

Acceptance:
- [ ] Given расширение шлёт track/state/cmd, when общая schema применяется и валидация/нормализация централизованы, then все компоненты обрабатывают payload одинаково.
- [ ] Given новое событие `onTrackChange`, when оно описано в контракте и импортировано в main/renderer, then code-pathы остаются совместимы.

### S1-02 Защитить локальный WS bridge токеном + dev-mode
- `Epic`: Security + Protocol
- `Story points`: 6
- `labels`: `epic/security`, `protocol`, `auth`
- `assignee`: `you`
- `depends on`: S1-01

Acceptance:
- [ ] Given extension без токена в prod, when подключается к `ws://127.0.0.1:18765`, then соединение отклоняется с диагностикой.
- [ ] Given корректный токен, when cmd/track приходят, then main принимает сообщения.
- [ ] Given `LOCAL_TRUST=true`, when legacy клиент без токена подключается, then соединение допускается для локальной разработки.

### S1-03 EventBus как единый источник состояния
- `Epic`: Event Infrastructure
- `Story points`: 7
- `labels`: `epic/core`, `infrastructure`, `events`
- `assignee`: `you`
- `depends on`: S1-01

Acceptance:
- [ ] Given приходит state/track из extension, when eventBus транслирует событие, then renderer + API-потоки получают единый payload.
- [ ] Given дубль одного event в коротком интервале, when приходит второй раз, then UI не дрожит и не дублирует update.

### S1-04 Плагинный runtime + lifecycle
- `Epic`: Plugin System
- `Story points`: 8
- `labels`: `epic/plugins`, `runtime`, `api`
- `assignee`: `you`
- `depends on`: S1-03

Acceptance:
- [ ] Given валидный plugin manifest, when app стартует, then plugin грузится и регистрирует подписки на события.
- [ ] Given ошибка init плагина, when runtime продолжает работу, then app живёт дальше и пишет статус failure.

### S1-05 UI mount points для плагинов
- `Epic`: Plugin UI
- `Story points`: 5
- `labels`: `epic/plugins`, `ui`, `renderer`
- `assignee`: `you`
- `depends on`: S1-04

Acceptance:
- [ ] Given plugin просит panel mount, when renderer инициализирован, then mount-point создаётся и рендерится без поломок основной UI.
- [ ] Given unauthorized DOM-модификация плагина, when выполняется, then она блокируется и событие логируется.

## Sprint 2 — Integrations + UX/OS

### Release scope lock (v0.3.3)
- В релиз входят: `S2-01`, `S2-02`, `S2-04`.
- `S2-03 Discord Rich Presence` исключён навсегда (не нужен по продуктовой задаче пользователя).
- `S2-05 Профили, hotkeys, tray actions` переносится на следующий цикл и в этом релизе не включается.

### S2-01 Локальный integration API (`/status`, `/current-track`, SSE/WS)
- `Epic`: Integrations Platform
- `Story points`: 6
- `labels`: `epic/integration`, `api`, `bridge`
- `assignee`: `you`
- `depends on`: S1-03

### S2-02 Last.fm scrobbling
- `Epic`: Integrations
- `Story points`: 7
- `labels`: `epic/integration`, `lastfm`, `queue`
- `assignee`: `you`
- `depends on`: S2-01

### S2-04 OBS overlay endpoint
- `Epic`: Integrations
- `Story points`: 5
- `labels`: `epic/integration`, `obs`, `streaming`
- `assignee`: `you`
- `depends on`: S2-01

### S2-05 Профили, hotkeys, tray actions
- `Epic`: OS + UX
- `Story points`: 8
- `labels`: `epic/os`, `hotkeys`, `tray`, `profiles`
- `assignee`: `you`
- `depends on`: S1-05

## Файлы-анкоры для старта разработки
- `app/src/main/ws_bridge.js`
- `app/src/main/main.js`
- `app/src/main/preload.js`
- `app/src/renderer/renderer.js`
- `extension/src/background.js`
- `extension/src/content.js`
- `extension/src/ytm_adapter.js`
- `app/package.json`
- `docs/protocol.md`
