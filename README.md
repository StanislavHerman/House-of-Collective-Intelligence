# 🏛 House of Collective Intelligence

![macOS](https://img.shields.io/badge/macOS-000000?style=for-the-badge&logo=apple&logoColor=white) ![Windows](https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white)

**AI Council in your Terminal**  
**Совет ИИ в твоем терминале**

---

### 🇬🇧 English

**House of Collective Intelligence** is a powerful CLI tool that allows you to consult with a "Council" of multiple AI models simultaneously. You appoint a **Chairman** (who answers you directly) and form a **Council** (who advises the Chairman).

#### ✨ Key Features
- **Multi-Model Support**: Use OpenAI, Anthropic, DeepSeek, xAI (Grok), Google Gemini, Perplexity, and OpenRouter.
- **Cross-Platform**: Works natively on **macOS** and **Windows** (no WSL required).
- **Role-Playing**: Assign roles (Chairman, Council Member) to different models.
- **Secretary Role**: Assign a dedicated "Secretary" agent to automatically evaluate Council efficiency (Actor-Critic pattern), ensuring precise stats without burdening the Chairman.
- **Session Persistence**: Resume your previous conversation exactly where you left off.
- **Smart Memory**: Auto-compacting context to save tokens while keeping the conversation going.
- **Privacy**: All keys and history are stored locally on your machine (`~/.council-ai/`).
- **Auto-Update**: Keep your app up-to-date with a single command.

#### 🤖 Agentic Capabilities
The Council is not just for chat. Agents can perform real actions on your computer (if you allow them):
- 🖥️ **Desktop Control**: Take screenshots and simulate keyboard input (works on **macOS** & **Windows**).
- 🌐 **Web Browsing**: Search the web, open pages, and interact with websites.
- 📁 **File System**: Read and write files in your current directory.
- 💻 **Terminal**: Execute shell commands (Bash on macOS/Linux, PowerShell on Windows).

*You can enable/disable these permissions anytime using the `/settings` command.*

#### 🚀 Installation

**Prerequisites:**
- **Node.js**: v18 or higher (v20 recommended).
- **Git**: To clone the repository.

**macOS / Linux:**
1. Clone the repository:
   ```bash
   git clone https://github.com/StanislavHerman/House-of-Collective-Intelligence.git
   cd House-of-Collective-Intelligence
   ```
2. Setup and Run:
   ```bash
   npm run setup
   # Or manually: npm install && npm run build
   ```
3. Start:
   ```bash
   ./hause
   ```

**Windows (PowerShell):**
1. Clone the repository:
   ```powershell
   git clone https://github.com/StanislavHerman/House-of-Collective-Intelligence.git
   cd House-of-Collective-Intelligence
   ```
2. Setup and Run (as Admin might be required for policy):
   ```powershell
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
   npm run setup
   # Or manually: npm install; npm run build
   ```
3. Start:
   ```cmd
   .\hause.cmd
   ```

#### 🔄 Updating
The `/update` command works **only if you cloned the repository using Git**.
If you downloaded the code as a ZIP archive:
1. Download the new version manually.
2. Run `npm run build` (or the install script) again.

#### 📋 Commands Menu (`/`)
- **/login**: Setup API keys for different providers.
- **/agents**: Create, delete, and manage AI agents (assign Chairman/Council).
- **/council**: Toggle Council on/off (save costs).
- **/settings**: Manage permissions for agent tools (browser, desktop control, file access, commands).
- **/status**: Check current team composition and balance.
- **/stats**: View efficiency statistics of your Council.
- **/update**: Check and install updates.
- **/mute**: Toggle "Quiet Mode" (hide Council internal discussions).
- **/compact**: Force memory compaction.
- **/lang**: Switch language (EN/RU).
- **/new**: Start a fresh conversation.

---

### 🇷🇺 Русский

**House of Collective Intelligence** — это мощный инструмент для терминала, который позволяет советоваться с "Советом" из нескольких ИИ одновременно. Вы назначаете **Председателя** (он отвечает вам) и собираете **Совет** (они дают советы Председателю).

#### ✨ Возможности
- **Мульти-модели**: Используйте OpenAI, Anthropic, DeepSeek, xAI (Grok), Google Gemini, Perplexity и OpenRouter.
- **Кроссплатформенность**: Работает нативно на **macOS** и **Windows** (WSL не требуется).
- **Роли**: Назначайте роли (Председатель, Член Совета) разным моделям.
- **Роль Секретаря**: Назначьте отдельного агента "Секретаря" для автоматической оценки эффективности Совета (паттерн Actor-Critic), что гарантирует точную статистику без нагрузки на Председателя.
- **Сохранение сессии**: Возобновите разговор с того места, где остановились, при следующем запуске.
- **Умная память**: Автоматическое сжатие контекста для экономии токенов при сохранении сути диалога.
- **Приватность**: Все ключи и история хранятся локально на вашем компьютере (`~/.council-ai/`).
- **Авто-обновление**: Обновление приложения одной командой.

#### 🤖 Агентские возможности
Совет — это не просто чат. Агенты могут выполнять реальные действия на вашем компьютере (если вы разрешите):
- 🖥️ **Управление ПК**: Скриншоты экрана и имитация клавиатуры (работает на **macOS** и **Windows**).
- 🌐 **Веб-браузинг**: Поиск в интернете, чтение сайтов и взаимодействие с ними.
- 📁 **Файловая система**: Чтение и создание файлов в текущей папке.
- 💻 **Терминал**: Выполнение системных команд (Bash на macOS/Linux, PowerShell на Windows).

*Вы можете управлять этими разрешениями в любой момент через команду `/settings`.*

#### 🚀 Установка

**Требования:**
- **Node.js**: v18 или выше (рекомендуется v20).
- **Git**: Для клонирования репозитория.

**macOS / Linux:**
1. Клонируйте репозиторий:
   ```bash
   git clone https://github.com/StanislavHerman/House-of-Collective-Intelligence.git
   cd House-of-Collective-Intelligence
   ```
2. Установка и запуск:
   ```bash
   npm run setup
   # Или вручную: npm install && npm run build
   ```
3. Запуск:
   ```bash
   ./hause
   ```

**Windows (PowerShell):**
1. Клонируйте репозиторий:
   ```powershell
   git clone https://github.com/StanislavHerman/House-of-Collective-Intelligence.git
   cd House-of-Collective-Intelligence
   ```
2. Установка и запуск (может потребоваться запуск от имени администратора):
   ```powershell
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
   npm run setup
   # Или вручную: npm install; npm run build
   ```
3. Запуск:
   ```cmd
   .\hause.cmd
   ```

#### 🔄 Обновление
Команда `/update` работает **только если вы клонировали репозиторий через Git**.
Если вы скачали код архивом (ZIP):
1. Скачайте новую версию вручную.
2. Запустите `npm run build` (или скрипт установки) заново.

#### 📋 Меню команд (`/`)
- **/login**: Настройка API ключей.
- **/agents**: Управление агентами (создание, удаление, назначение в Совет).
- **/council**: Вкл/Выкл Совет (экономия токенов).
- **/settings**: Настройки доступа агентов к инструментам (браузер, управление ПК, файлы, команды).
- **/status**: Статус команды и баланс.
- **/stats**: Статистика эффективности Совета.
- **/update**: Проверка и установка обновлений.
- **/mute**: "Тихий режим" (скрыть внутренние обсуждения Совета).
- **/compact**: Сжать память вручную.
- **/lang**: Сменить язык (RU/EN).
- **/new**: Начать новый диалог.
