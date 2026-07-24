#!/bin/sh
# Entrypoint: Volume-Permissions korrigieren, ggf. SESSION_SECRET erzeugen,
# dann als unprivilegierter node-User starten (Yuvomi-Konvention).
set -e

# SESSION_SECRET automatisch erzeugen, falls leer (Persistenz in /data/.env.auto)
if [ -z "$SESSION_SECRET" ]; then
  if [ -f /data/.env.auto ]; then
    SESSION_SECRET=$(grep '^SESSION_SECRET=' /data/.env.auto | cut -d= -f2-)
  fi
  if [ -z "$SESSION_SECRET" ]; then
    SESSION_SECRET=$(head -c 48 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 48)
    echo "SESSION_SECRET=$SESSION_SECRET" >> /data/.env.auto
    echo "[entrypoint] Generated SESSION_SECRET -> /data/.env.auto"
  fi
  export SESSION_SECRET
fi

# Bei root-Start: Ownership der Volumes korrigieren + via gosu zu node wechseln.
# Bei non-root-Start (z.B. TrueNAS als 568:568): direkt starten.
if [ "$(id -u)" = "0" ]; then
  chown -R node:node /data /app/modules 2>/dev/null || true
  exec gosu node "$@"
fi
exec "$@"
