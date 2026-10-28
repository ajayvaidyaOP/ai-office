# Troubleshooting

Most failures come from credentials, local networking, invalid AI output or duplicate data.
Fix one thing at a time and test with a small example.

## First move: `npm run check`

```bash
npm run check
```

It boots a throwaway instance, runs the full flow and prints a checklist. If it passes, the
office logic is fine and the problem is in your environment (Docker, Ollama, Telegram, Sheets).

## Common problems

| Area | Problem | Fix |
| --- | --- | --- |
| Docker / n8n | Port 5678 already in use | Stop the other process or change the host port: `-p 5679:5678` |
| Docker / n8n | Container disappears after stopping | You used `--rm`; use Compose or drop `--rm` |
| Docker / n8n | `N8N_ENCRYPTION_KEY` changed → credentials unreadable | Restore the old key, or re-enter credentials |
| Ollama | Model very slow | Smaller model, close heavy apps, more RAM/VRAM |
| Ollama | n8n cannot connect | Check base URL; use `host.docker.internal` when n8n is in Docker |
| Ollama | `model not found` | `ollama pull <model>` and match the name exactly, including the tag |
| Ollama | Works in terminal, not in n8n | Ollama binds to `127.0.0.1`; set `OLLAMA_HOST=0.0.0.0` or use host networking |
| Google | OAuth consent fails | Recheck client, redirect URI and enabled Sheets API |
| Google | Sheets node cannot find tab | Exact tab name and spreadsheet ID; watch for trailing spaces |
| Google | `redirect_uri_mismatch` | Copy the URI from n8n into Google Cloud verbatim |
| Telegram | Bot does not respond | Token, bot started (send `/start`), user ID allow-list |
| Telegram | `409 Conflict` | Two pollers on one bot — stop one |
| Telegram | Buttons do nothing | Callback handler missing; commands still work as text |
| AI output | Invalid JSON | "Return ONLY valid JSON", lower temperature, validate, retry once |
| AI output | Draft ignores tone | Put tone in the system prompt, not the user message |
| AI output | Invented facts | Add "do not invent" rules, require source URLs, keep a human gate |
| API limits | Rate-limit errors | Delays, fewer calls, caching, monitor quotas |
| Data | Duplicate rows | Unique IDs, dedupe window, check before append |
| Data | `db.json` corrupt | Start once with the file renamed; a `.corrupt` backup is kept |
| Hosting | Laptop sleep stops everything | Always-on machine, home server, or cloud VM |
| UI | Console loads but state is empty | Check `PORT`, `DATA_DIR`, and whether `/api/state` responds |

## Office-specific checks

### "Engine" tag stays `offline`

1. `ollama list` — is a model installed?
2. `curl http://localhost:11434/api/tags` — does it answer?
3. If the office runs in Docker, set `OLLAMA_BASE_URL=http://host.docker.internal:11434`.
4. **Setup → Test connection** — read the error text, not just the colour.
5. Still stuck? `AI_PROVIDER=offline` keeps everything working while you fix it.

### `/draft` says "No draft found for that ID"

The ID belongs to a task (`T-`), not a draft (`D-`). Use `/report` to see draft IDs.

### "Invalid JSON body" from curl

Shell quoting swallowed a newline. Use a file or the console:

```bash
curl -s localhost:3000/api/command \
  -H 'content-type: application/json' \
  -d "$(python3 -c 'import json;print(json.dumps({"raw":"/status"}))')"
```

### Telegram says "This bot is private"

Your numeric ID is not in `ALLOWED_TELEGRAM_USER_IDS`. Get it from @userinfobot and restart
the office. Check the Audit tab — the attempt should appear as `telegram.denied`.

### Data looks wrong after a reset

`/api/reset` is destructive and cannot be undone. Restore from `backups/<timestamp>/db.json`:
stop the office, copy it back to `data/db.json`, start again.

## Error messages you may see

| Message | Meaning |
| --- | --- |
| `No AI provider is reachable` | Neither Ollama nor Gemini answered — offline fallback engaged |
| `Daily model call limit reached` | Cost cap; raise `MAX_MODEL_CALLS_PER_DAY` or wait for tomorrow |
| `Gemini temporarily paused after an error` | 401/403/429 — 10-minute cool-down |
| `No tasks array in the AI response` | Model returned prose; validator fell back |
| `A public source URL is required` | `/lead` without a source — intentional |
| `Payload too large` | Request over 1 MB — do not paste huge files into the console |
| `Add the x-office-code header` | `OFFICE_ACCESS_CODE` is set; send the header |

## Reset procedure (safe order)

```bash
npm run backup                      # 1. keep a copy
docker compose stop office          # 2. stop the app
cp data/db.json data/db.json.old    # 3. keep the raw file too
# 4. use Setup → Reset, or delete data/db.json and restart
npm start
```

## When to stop debugging

If two hours have gone into a connector, switch to the simpler path: use this app's console
instead of n8n, CSV instead of Sheets OAuth, or the offline engine instead of Ollama. The
workflow matters more than the tooling. Come back to the connector with fresh eyes.
