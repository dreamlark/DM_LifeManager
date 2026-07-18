@echo off
setlocal EnableExtensions

rem === DM Life launcher: single window, sequential readiness, auto-open browser ===
rem Ports (edit if a port is already in use by something else)
set "ENGINE_PORT=14570"
set "SERVER_PORT=4100"
set "WEB_PORT=5173"

rem Project root = folder containing this .bat (strip trailing backslash)
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "LOGDIR=%ROOT%\.logs"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
set "PORT_FILE=%TEMP%\.dm-life.engine.port"
set "ENGINE_URL=http://127.0.0.1:%ENGINE_PORT%"

rem Create a desktop shortcut "DMlife" (3D floating anime icon); always overwrite to pick up icon updates
rem Icon cache flush: delete IconCache.db + restart explorer.exe (only reliable way to clear in-memory icon handles)
powershell -NoProfile -Command "$scp=Join-Path $env:USERPROFILE 'Desktop\DMlife.lnk'; $ico=Join-Path $env:ROOT 'assets\DMlife.ico'; $shell=New-Object -ComObject WScript.Shell; $lnk=$shell.CreateShortcut($scp); $lnk.TargetPath=Join-Path $env:ROOT 'start-dm-life.bat'; $lnk.WorkingDirectory=$env:ROOT; $lnk.IconLocation=$ico; $lnk.Description='DM Life'; $lnk.Save(); Write-Host '[DM Life] desktop shortcut DMlife.lnk created/updated'; Start-Sleep -Milliseconds 200; if(Test-Path $ico){ (Get-Item $ico).LastWriteTime=Get-Date }; $icdb=Join-Path $env:LOCALAPPDATA 'IconCache.db'; if(Test-Path $icdb){ Remove-Item $icdb -Force -ErrorAction SilentlyContinue; Write-Host '[DM Life] IconCache.db deleted' }; ie4uinit.exe -show 2>$null; Write-Host '[DM Life] icon cache refresh triggered'"

echo [DM Life] Freeing ports used by previous runs (if any) ...
call :killports

echo [DM Life] Starting engine + collab server + web (all background, logs in .logs/) ...
start /b "" cmd /c "cd /d %ROOT%\packages\engine && set PORT=%ENGINE_PORT% && npm run start > %LOGDIR%\engine.log 2>&1"
start /b "" cmd /c "cd /d %ROOT%\packages\server && set PORT=%SERVER_PORT% && set CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR= && set CODEBUDDY_TOOL_CALL_ID= && set PGLITE_DIR=%ROOT%\.collab-data && npm run start > %LOGDIR%\server.log 2>&1"
start /b "" cmd /c "cd /d %ROOT%\packages\web-collab && npm run dev -- --port %WEB_PORT% --strictPort > %LOGDIR%\web.log 2>&1"

echo [DM Life] Waiting for engine + web ready (collab server warms in background) ...
call :waitengine
call :waitweb

echo [DM Life] Frontend ready. Opening browser ...
start "" "http://localhost:%WEB_PORT%/"

rem Collab server (PGLite cold boot ~30s) warms in background; prints one line when ready, never blocks the browser open.
start /b "" powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 180;$i++){try{$t=New-Object System.Net.Sockets.TcpClient;$t.Connect('127.0.0.1',%SERVER_PORT%);if($t.Connected){$t.Close();$ok=$true;break}}catch{};Start-Sleep -Milliseconds 500}; if($ok){Write-Host '[DM Life] collab server ready (port %SERVER_PORT%) - family features live'}else{Write-Host '[DM Life] collab server TIMEOUT - check %LOGDIR%\server.log'}"

echo.
echo [DM Life] Running in this single window. Press any key to stop all services.
pause >nul

echo [DM Life] Stopping services ...
call :killports
echo [DM Life] Done.
goto :eof

rem --- kill all DM Life ports + stale port file in ONE PowerShell process (aggressive) ---
:killports
powershell -NoProfile -Command "try { $ports = @(4100, 5173); for ($p = 14570; $p -le 14579; $p++) { $ports += $p }; $pf = Join-Path $env:TEMP '.dm-life.engine.port'; if (Test-Path $pf) { Remove-Item $pf -Force -ErrorAction SilentlyContinue }; $conns = Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { $ports -contains $_.LocalPort -and $_.State -eq 'Listen' }; $procs = $conns | Select-Object -ExpandProperty OwningProcess -Unique; foreach ($pidVal in $procs) { try { $proc = Get-Process -Id $pidVal -ErrorAction Stop; taskkill /F /T /PID $pidVal 2>$null; if (Get-Process -Id $pidVal -ErrorAction SilentlyContinue) { Stop-Process -Id $pidVal -Force -ErrorAction SilentlyContinue }; Write-Host ('[DM Life] killed PID ' + $pidVal + ' (' + $proc.ProcessName + ')') } catch {} }; Start-Sleep -Milliseconds 500; $still = Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { $ports -contains $_.LocalPort -and $_.State -eq 'Listen' }; if ($still) { Write-Host '[DM Life] WARNING: some ports still occupied - may be orphan processes'; $still | ForEach-Object { Write-Host ('  port ' + $_.LocalPort + ' PID ' + $_.OwningProcess) } } } catch {}"
goto :eof

rem --- poll a TCP port until it accepts connections (up to 60s) ---
:waitport
set "P=%~1"
set "NAME=%~2"
powershell -NoProfile -Command "$ok=$false; for($i=0; $i -lt 120; $i++){try{$t=New-Object System.Net.Sockets.TcpClient;$t.Connect('127.0.0.1',%P%);if($t.Connected){$t.Close();$ok=$true;break}}catch{};Start-Sleep -Milliseconds 500}; if($ok){Write-Host '[DM Life] %NAME% ready at http://127.0.0.1:%P%/'}else{Write-Host '[DM Life] %NAME% TIMEOUT - check %LOGDIR%\%NAME%.log'}"
goto :eof

rem --- wait for engine: prefer port file (written by fresh engine), scan only as fallback ---
:waitengine
powershell -NoProfile -Command "$found=$null; $pf='%PORT_FILE%'; if(Test-Path $pf){ $v=(Get-Content $pf -Raw -ErrorAction SilentlyContinue); if($v){ $v=$v.Trim(); if($v -match '^\d+$'){ $found=[int]$v } } }; if(-not $found){ for($p=14570; $p -le 14579; $p++){ try{ $r=Invoke-WebRequest -Uri ('http://127.0.0.1:'+$p+'/_routes') -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop; if($r.StatusCode -eq 200){ $found=$p; break } }catch{} } }; if(-not $found){ $found='%ENGINE_PORT%' }; $ok=$false; for($i=0; $i -lt 60; $i++){ try{ $r=Invoke-WebRequest -Uri ('http://127.0.0.1:'+$found+'/_routes') -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop; if($r.StatusCode -eq 200){ $ok=$true; break } }catch{}; Start-Sleep -Milliseconds 500 }; if($ok){ Write-Host ('[DM Life] engine ready on port '+$found) }else{ Write-Host '[DM Life] engine TIMEOUT - check .logs\engine.log' }"
goto :eof

rem --- wait for web dev server, then verify /engine proxy reaches engine ---
:waitweb
powershell -NoProfile -Command "$ok=$false; for($i=0; $i -lt 60; $i++){try{$t=New-Object System.Net.Sockets.TcpClient;$t.Connect('127.0.0.1', %WEB_PORT%);if($t.Connected){$t.Close();$ok=$true;break}}catch{};Start-Sleep -Milliseconds 500}; if(-not $ok){Write-Host '[DM Life] web TIMEOUT - check .logs\web.log';exit}; $proxy='http://127.0.0.1:%WEB_PORT%/engine/_routes'; $ok=$false; for($i=0; $i -lt 60; $i++){try{$res=Invoke-WebRequest -Uri $proxy -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop; if($res.StatusCode -eq 200){$ok=$true;break}}catch{};Start-Sleep -Milliseconds 500}; if($ok){Write-Host '[DM Life] web + /engine proxy ready'}else{Write-Host '[DM Life] web ready but /engine proxy TIMEOUT - check .logs\web.log'}"
goto :eof
