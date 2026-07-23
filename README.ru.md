<p align="center">
  <a href="https://agenthorsy.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Horsy logo">
    </picture>
  </a>
</p>
<p align="center">Открытый AI-агент для программирования.</p>
<p align="center">
  <a href="https://agenthorsy.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/agenthorsy-ai"><img alt="npm" src="https://img.shields.io/npm/v/agenthorsy-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/agenthorsy/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/agenthorsy/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![Horsy Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://agenthorsy.ai)

---

### Установка

```bash
# YOLO
curl -fsSL https://agenthorsy.ai/install | bash

# Менеджеры пакетов
npm i -g agenthorsy-ai@latest        # или bun/pnpm/yarn
scoop install agenthorsy             # Windows
choco install agenthorsy             # Windows
brew install anomalyco/tap/agenthorsy # macOS и Linux (рекомендуем, всегда актуально)
brew install agenthorsy              # macOS и Linux (официальная формула brew, обновляется реже)
sudo pacman -S agenthorsy            # Arch Linux (Stable)
paru -S agenthorsy-bin               # Arch Linux (Latest from AUR)
mise use -g agenthorsy               # любая ОС
nix run nixpkgs#agenthorsy           # или github:anomalyco/agenthorsy для самой свежей ветки dev
```

> [!TIP]
> Перед установкой удалите версии старше 0.1.x.

### Десктопное приложение (BETA)

Horsy также доступен как десктопное приложение. Скачайте его со [страницы релизов](https://github.com/anomalyco/agenthorsy/releases) или с [agenthorsy.ai/download](https://agenthorsy.ai/download).

| Платформа             | Загрузка                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `agenthorsy-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `agenthorsy-desktop-mac-x64.dmg`     |
| Windows               | `agenthorsy-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm` или AppImage        |

```bash
# macOS (Homebrew)
brew install --cask agenthorsy-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/agenthorsy-desktop
```

#### Каталог установки

Скрипт установки выбирает путь установки в следующем порядке приоритета:

1. `$AGENTHORSY_INSTALL_DIR` - Пользовательский каталог установки
2. `$XDG_BIN_DIR` - Путь, совместимый со спецификацией XDG Base Directory
3. `$HOME/bin` - Стандартный каталог пользовательских бинарников (если существует или можно создать)
4. `$HOME/.agenthorsy/bin` - Fallback по умолчанию

```bash
# Примеры
AGENTHORSY_INSTALL_DIR=/usr/local/bin curl -fsSL https://agenthorsy.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://agenthorsy.ai/install | bash
```

### Agents

В Horsy есть два встроенных агента, между которыми можно переключаться клавишей `Tab`.

- **build** - По умолчанию, агент с полным доступом для разработки
- **plan** - Агент только для чтения для анализа и изучения кода
  - По умолчанию запрещает редактирование файлов
  - Запрашивает разрешение перед выполнением bash-команд
  - Идеален для изучения незнакомых кодовых баз или планирования изменений

Также включен сабагент **general** для сложных поисков и многошаговых задач.
Он используется внутренне и может быть вызван в сообщениях через `@general`.

Подробнее об [agents](https://agenthorsy.ai/docs/agents).

### Документация

Больше информации о том, как настроить Horsy: [**наши docs**](https://agenthorsy.ai/docs).

### Вклад

Если вы хотите внести вклад в Horsy, прочитайте [contributing docs](./CONTRIBUTING.md) перед тем, как отправлять pull request.

### Разработка на базе Horsy

Если вы делаете проект, связанный с Horsy, и используете "opencode" как часть имени (например, "opencode-dashboard" или "opencode-mobile"), добавьте примечание в README, чтобы уточнить, что проект не создан командой Horsy и не аффилирован с нами.

---

**Присоединяйтесь к нашему сообществу** [Discord](https://agenthorsy.ai/discord) | [X.com](https://x.com/agenthorsy)
