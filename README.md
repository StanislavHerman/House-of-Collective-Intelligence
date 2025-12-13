# 🏛 House of Collective Intelligence

**AI Council in your Terminal**  
**Совет ИИ в твоем терминале**

---

### 🇬🇧 English

**House of Collective Intelligence** is a powerful CLI tool that allows you to consult with a "Council" of multiple AI models simultaneously. You appoint a **Chairman** (who answers you directly) and form a **Council** (who advises the Chairman).

#### ✨ Key Features
- **Multi-Model Support**: Use OpenAI, Anthropic, DeepSeek, xAI (Grok), Google Gemini, Perplexity, and OpenRouter.
- **Role-Playing**: Assign roles (Chairman, Council Member) to different models.
- **Smart Memory**: Auto-compacting context to save tokens while keeping the conversation going.
- **Privacy**: All keys and history are stored locally on your machine (`~/.council-ai/`).
- **Auto-Update**: Keep your app up-to-date with a single command.

#### 🚀 Installation
1. Clone the repository.
2. Run the installation script:
   ```bash
   ./install.sh
   ```
3. Start the app:
   ```bash
   ./hause
   ```

#### 📋 Commands Menu (`/`)
- **/login**: Setup API keys for different providers.
- **/agents**: Create, delete, and manage AI agents (assign Chairman/Council).
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
- **Роли**: Назначайте роли (Председатель, Член Совета) разным моделям.
- **Умная память**: Автоматическое сжатие контекста для экономии токенов при сохранении сути диалога.
- **Приватность**: Все ключи и история хранятся локально на вашем компьютере (`~/.council-ai/`).
- **Авто-обновление**: Обновление приложения одной командой.

#### 🚀 Установка
1. Скачайте репозиторий.
2. Запустите скрипт установки:
   ```bash
   ./install.sh
   ```
3. Запустите программу:
   ```bash
   ./hause
   ```

#### 📋 Меню команд (`/`)
- **/login**: Настройка API ключей.
- **/agents**: Управление агентами (создание, удаление, назначение в Совет).
- **/status**: Статус команды и баланс.
- **/stats**: Статистика эффективности Совета.
- **/update**: Проверка и установка обновлений.
- **/mute**: "Тихий режим" (скрыть внутренние обсуждения Совета).
- **/compact**: Сжать память вручную.
- **/lang**: Сменить язык (RU/EN).
- **/new**: Начать новый диалог.
