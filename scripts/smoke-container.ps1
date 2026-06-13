# Post-deploy smoke checks for agent-wechat container.
# Usage: .\scripts\smoke-container.ps1 [-Container agent-wechat] [-Port 6174]

param(
    [string]$Container = "agent-wechat",
    [int]$Port = 6174
)

$ErrorActionPreference = "Continue"
$failures = @()

function Fail([string]$msg) {
    $script:failures += $msg
    Write-Host "FAIL: $msg" -ForegroundColor Red
}

function Pass([string]$msg) {
    Write-Host "OK:   $msg" -ForegroundColor Green
}

function Warn([string]$msg) {
    Write-Host "WARN: $msg" -ForegroundColor Yellow
}

Write-Host "==> Smoke check for container '$Container' (port $Port)"
Write-Host ""

# Container running
$running = docker ps --filter "name=$Container" --format "{{.Names}}" 2>$null
if (-not $running) {
    Fail "Container '$Container' is not running"
    Write-Host ""
    Write-Host "Summary: $($failures.Count) failure(s)"
    exit 1
}
Pass "Container is running"

# Health endpoint
$health = docker exec $Container curl -sf "http://127.0.0.1:${Port}/health" 2>$null
if ($health -match '"status"\s*:\s*"ok"') {
    Pass "/health returned ok"
} else {
    Fail "/health did not return ok (got: $health)"
}

# Recent agent logs
Write-Host ""
Write-Host "==> Last 20 agent-server log lines"
docker logs $Container 2>&1 | Select-String -Pattern "agent_server" | Select-Object -Last 20 | ForEach-Object { Write-Host $_.Line }

# Bridge / HTTP bind
$logs = docker logs $Container 2>&1 | Out-String
if ($logs -match "agent-server listening on http://0\.0\.0\.0:$Port") {
    Pass "agent-server listening on port $Port"
} else {
    Warn "Could not find 'listening on' in logs (may appear after restart)"
}

if ($logs -match "Bridge running") {
    Pass "Bridge spawned"
} else {
    Warn "Bridge running not found in logs"
}

# WeChat login state
Write-Host ""
Write-Host "==> WeChat login state"
$loginLines = docker logs $Container 2>&1 | Select-String -Pattern "mainWindow=" | Select-Object -Last 5
$lastMainWindow = ""
foreach ($line in $loginLines) {
    if ($line -match "mainWindow=(\S+)") {
        $lastMainWindow = $Matches[1].TrimEnd(',')
    }
}

switch -Regex ($lastMainWindow) {
    "^chat(_open)?$" {
        Pass "WeChat logged in (mainWindow=$lastMainWindow)"
        if ($lastMainWindow -eq "chat_open") { $lastMainWindow = "chat" }
    }
    "^login_" {
        Warn "WeChat not logged in (mainWindow=$lastMainWindow)"
        $tokenPath = Join-Path $env:USERPROFILE ".config\agent-wechat\token"
        if (Test-Path $tokenPath) {
            $token = (Get-Content $tokenPath -Raw).Trim()
            Write-Host "      VNC: http://localhost:${Port}/vnc/?token=${token}&autoconnect=true"
        } else {
            Write-Host "      Complete login via VNC: http://localhost:${Port}/vnc/?token=<your-token>&autoconnect=true"
            Write-Host "      Token file: $tokenPath"
        }
        Write-Host "      After login, send a private message and look for '<- N messages' / 'Sent:' in logs."
    }
    default {
        if ($lastMainWindow) {
            Warn "Unknown mainWindow=$lastMainWindow"
        } else {
            Warn "No mainWindow= lines in logs yet"
        }
    }
}

# Message processing + DB path checks (when logged in)
$recentLogs30 = docker logs $Container --since 30m 2>&1 | Out-String
$recentLogs5 = docker logs $Container --since 5m 2>&1 | Out-String

Write-Host ""
Write-Host "==> WeChat DB path checks"
$wrongRecent = [regex]::Matches($recentLogs5, "db_storage/message_\d+/message_\d+\.db").Count
$wrongHistorical = [regex]::Matches($recentLogs30, "db_storage/message_\d+/message_\d+\.db").Count
if ($wrongRecent -gt 0) {
    Fail "Old wechat_db shard path in last 5m ($wrongRecent hits) - run .\scripts\dev-deploy.ps1"
} elseif ($wrongHistorical -gt 0) {
    Warn "Wrong message_N/message_N.db paths in last 30m ($wrongHistorical hits) but none in last 5m - likely fixed after redeploy"
} else {
    Pass "No wrong message_N/message_N.db paths in last 30m"
}

if ($lastMainWindow -eq "chat") {
    if ($recentLogs30 -match "Sent:") {
        Pass "Bridge Sent: seen in last 30m"
    }
    if ($recentLogs30 -match "<-\s+\d+\s+messages|chat_processor.*<-") {
        Pass "Bridge received messages (<- N messages) in last 30m"
    } elseif ($recentLogs30 -notmatch "Sent:") {
        Warn "No '<- N messages' / 'Sent:' in last 30m - send a test private message"
    }
} elseif ($lastMainWindow -match "^login_") {
    Write-Host "      (Message flow check skipped until mainWindow=chat)"
}

# wechat-keys loop
$keyErrors = ($logs | Select-String -Pattern "\[wechat-keys\] Missing keys" -AllMatches).Matches.Count
if ($keyErrors -gt 5) {
    Warn "[wechat-keys] Missing keys appeared $keyErrors times - check key extraction"
} else {
    Pass "No runaway wechat-keys Missing keys loop"
}

Write-Host ""
if ($failures.Count -gt 0) {
    Write-Host "Summary: $($failures.Count) failure(s)" -ForegroundColor Red
    exit 1
}
Write-Host "Summary: infrastructure checks passed" -ForegroundColor Green
if ($lastMainWindow -match "^login_") {
    Write-Host "Next: complete WeChat login via VNC, then re-run this script or send a test message."
    exit 2
}
exit 0
