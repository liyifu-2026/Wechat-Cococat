# Bridge smoke checklist

Run with agent-server + WeChat session logged in. Watch logs for `[poll]` and `Process chat`.

## Deployment smoke (after hot-deploy or compose up)

On Windows, run:

```powershell
.\scripts\smoke-container.ps1
```

Manual checks:

| Step | Command / action | Expected |
|------|------------------|----------|
| Health | `docker exec agent-wechat curl -s http://127.0.0.1:6174/health` | `{"status":"ok"}` |
| Listen | `docker logs agent-wechat 2>&1 \| Select-String listening` | `agent-server listening on http://0.0.0.0:6174` |
| Bridge | same logs | `Bridge running` |
| WeChat login | VNC `http://localhost:6174/vnc/?token=<token>&autoconnect=true` | mainWindow=chat in logs |
| Message | send one private chat message | log shows `<- N messages` then `Sent:` |
| Keys | logs | no repeating `[wechat-keys] Missing keys` loop |

Daily Rust changes: `.\scripts\dev-deploy.ps1` (PowerShell). Full image rebuild: `./scripts/build-images-local.sh --release` then `docker compose up -d`.

## E2E login + bridge (blocker if not logged in)

1. Open VNC with your token (see `~/.config/agent-wechat/token`).
2. Scan QR or confirm phone login until logs show `mainWindow=chat`.
3. Send a private message to the bot account.
4. Expect within ~2s debounce: `"{name} <- 1 messages"`, LLM turn, then `Sent:`.
5. Optional @mention: POST to messages API with `mentions` field (bridge auto-reply does not pass mentions).

If smoke exits code 2, infrastructure is OK but WeChat login is still required.

## Debounce (WS, 1s)

1. Send 3 text messages to the bot within 2 seconds in one chat.
2. Expect one LLM turn (~1s after the last message), not three.
3. Log should show a single `"{name} <- N messages"` with N ¡Ý 3.

## Conflict retry (2s, non-blocking poll)

1. While the bot is replying (LLM in flight), send another message in the same chat.
2. Expect log: `already in progress ¡ª retry in 2s`.
3. Poll loop should continue (other chats still get `[poll] Checking` on schedule).
4. Within ~2s after the first reply finishes, the new message should be processed.

## Poll edge trigger

1. Note a chat with stable unread badge (e.g. unread=2 unchanged).
2. Wait two poll cycles (~4s).
3. Expect **no** repeated `[poll] Queueing` for that chat while unread count is unchanged.
4. Send a new message; unread should increase ¡ú one `[poll] Queueing ... (unread=X, prev=Y)` with X > Y.

## Seen / send

1. Kill network or break send mid-reply once; message must **not** be marked seen (should retry on next push or poll).
