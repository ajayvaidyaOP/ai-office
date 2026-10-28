# Install — Docker, n8n, Ollama, Telegram

Everything here maps to Chapter 3 of the guide. You do **not** need all of it to start:
`npm start` runs the office on its own.

## 0. Requirements

| Item | Minimum | Notes |
| --- | --- | --- |
| Computer | 8 GB RAM (16 GB recommended) | local models need RAM and disk |
| Free storage | 20 GB+ | Docker images and model files are large |
| Node.js | 20 or newer | no npm packages required |
| Internet | stable broadband | model downloads, Google, Telegram |
| Software cost | ₹0 to start | all core tools have free tiers |

Check Node:

```bash
node -v      # v20.x or newer
```

## 1. Run the office

```bash
cp .env.example .env     # optional; sensible defaults are built in
npm start                # http://localhost:3000
```

Verify:

```bash
npm run check
```

The check script tests the health endpoint, the state endpoint, an offline `/task`, an
offline `/draft`, the approval gate and the CSV export. It prints a pass/fail checklist.

## 2. Ollama (local model, free)

Install:

- **Windows** — run `OllamaSetup.exe` from <https://ollama.com/download>. No admin rights
  needed; it installs into your home directory.
- **macOS** — open the `.dmg`, drag Ollama into Applications.
- **Linux** — `curl -fsSL https://ollama.com/install.sh | sh`

Pull a small model first:

```bash
ollama pull llama3.2
ollama list                 # confirm it is there
ollama run llama3.2 "hello" # optional smoke test
```

Point the office at it:

```bash
# .env
AI_PROVIDER=auto
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
```

Then **Setup → Test connection** in the console. The engine tag should switch to `ollama`.

### Model size guidance

| Model (example) | Size | Runs comfortably on |
| --- | --- | --- |
| `llama3.2` | ~2 GB | 8 GB RAM |
| `qwen2.5:3b` | ~2 GB | 8 GB RAM |
| `llama3.1:8b` | ~4.7 GB | 16 GB RAM |
| `qwen2.5:14b` | ~9 GB | 16–32 GB RAM |

Do not choose a model only because it is popular. Check size, licence and quality on your
own tasks; upgrade only when the small model actually fails you.

## 3. Docker and n8n

### Install Docker

- **Windows** — Docker Desktop installer, follow the wizard, start Docker Desktop.
- **macOS** — Docker Desktop `.dmg`, drag to Applications, start it.
- **Linux** — Docker Engine + Compose plugin from your distribution's instructions.

Confirm:

```bash
docker --version
docker compose version
```

### Quick test (the guide's command)

```bash
docker volume create n8n_data
docker run -it --rm --name n8n -p 5678:5678 \
  -v n8n_data:/home/node/.n8n \
  docker.n8n.io/n8nio/n8n
```

Open <http://localhost:5678>. `--rm` deletes the container when it stops — fine for a test,
wrong for real use.

### Long-running setup (this repo)

```bash
cp .env.example .env
# edit .env: set N8N_ENCRYPTION_KEY to a random string, and your timezone
docker compose up -d n8n
docker compose logs -f n8n
```

`docker-compose.yml` in this repo:

- keeps data in the named volume `n8n_data`;
- binds n8n to `0.0.0.0:5678` so a hosted machine or the preview proxy can reach it;
- adds `host.docker.internal` for Linux so n8n can reach Ollama on the host;
- sets `N8N_SECURE_COOKIE=false` for local http testing (turn it back on behind HTTPS);
- optionally starts this office container on port 3000.

Generate a key:

```bash
openssl rand -hex 32
```

### Ollama base URL inside Docker

| Situation | Base URL |
| --- | --- |
| n8n in Docker, Ollama on the host | `http://host.docker.internal:11434` |
| n8n and Ollama both on the host, no Docker | `http://localhost:11434` |
| both in Docker on the same network | `http://ollama:11434` |

On Linux, `host.docker.internal` needs:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

This is already in the compose file.

## 4. Telegram bot

1. In Telegram, search for **@BotFather**.
2. Send `/newbot`, choose a display name, then a username ending in `bot`.
3. Copy the token **once** and put it in `.env`:

   ```bash
   TELEGRAM_BOT_TOKEN=123456:ABC...
   ALLOWED_TELEGRAM_USER_IDS=123456789
   TELEGRAM_MODE=polling
   ```

4. Find your numeric user ID: message **@userinfobot** (or any ID bot) and copy the number.
   Never use your username as an allow-list entry.
5. Restart the office. Start a chat with your bot and send `/status`.

Security notes:

- The token is a password. Keep it in `.env` or the n8n credential store, never in Sheets,
  screenshots or a Git commit.
- Restrict the bot to your own user ID. An unrestricted bot can burn credits and write rows.
- If two processes poll the same bot you will get `409 Conflict`; keep one consumer only.

### Webhook mode (optional)

If the office is reachable on a public URL:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://your-domain/api/webhook/telegram" \
  -d "secret_token=$WEBHOOK_SECRET"
```

Set `WEBHOOK_SECRET` in `.env` too — the server rejects updates without the matching
`X-Telegram-Bot-Api-Secret-Token` header. Keep `TELEGRAM_MODE=off` in webhook mode.

## 5. Google Sheets

See `03-google-sheets.md`. Short version: create a spreadsheet named **AI Invincible Office**
with tabs `Tasks`, `Drafts`, `Leads`, `Daily Log`, then import the CSVs from
**Setup → Google Sheets** or `templates/`.

## 6. Verify the whole stack

```bash
npm run check                       # office self-check
open http://localhost:3000          # console
open http://localhost:5678          # n8n
ollama list                         # model present
curl -s localhost:3000/api/state | head -c 400
```

If all four respond, you have the Chapter 3 baseline: command centre, orchestration,
model, database.
