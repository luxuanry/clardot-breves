#!/usr/bin/env bash
# Stops any dev server of this project still listening on ports 3000-3010,
# reports old copies of the project that were running elsewhere,
# then starts a fresh dev server from this folder.
# Usage: npm run dev:clean            (live info-financiere API)
#        npm run dev:clean -- demo    (replays fixtures/sample-records.json)

set -u
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR" || exit 1

echo "Projet : $PROJECT_DIR"
echo

pids=$(lsof -nP -iTCP:3000-3010 -sTCP:LISTEN -t 2>/dev/null | sort -u)
if [ -z "$pids" ]; then
  echo "Aucun serveur en cours sur les ports 3000-3010."
else
  for pid in $pids; do
    cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
    port=$(lsof -a -p "$pid" -nP -iTCP -sTCP:LISTEN -Fn 2>/dev/null | sed -n 's/^n.*://p' | head -1)
    case "$cwd" in
      *clardot-breves*)
        kill "$pid" && echo "Arrêté : port $port (PID $pid) lancé depuis $cwd"
        if [ "$cwd" != "$PROJECT_DIR" ]; then
          echo "  -> ANCIENNE COPIE du projet : $cwd"
          echo "     Vous pouvez la supprimer après vérification : rm -rf \"$cwd\""
        fi
        ;;
      *)
        echo "Laissé tel quel : port $port (PID $pid), autre projet : $cwd"
        ;;
    esac
  done
fi

sleep 1
echo
if [ "${1:-}" = "demo" ]; then
  echo "Démarrage en mode démo (données enregistrées, pas d'appel API)..."
  export AMF_USE_FIXTURE=1
else
  echo "Démarrage avec l'API info-financière en direct..."
fi
echo "Ouvrez http://localhost:3000 puis faites Cmd + Shift + R."
echo
exec npm run dev -- -p 3000
