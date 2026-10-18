#!/bin/bash
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME="$ROOT/.local-webapp"
SERVER_DIR="$ROOT/server"
CLIENT_DIR="$ROOT/client"
SERVER_PORT=5001
CLIENT_PORT=5173

mkdir -p "$RUNTIME"

listener_pid() {
  /usr/sbin/lsof -nP -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -n 1
}

tracked_pid() {
  local file="$RUNTIME/$1.pid"
  local pid
  [ -f "$file" ] || return 1
  IFS= read -r pid < "$file"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  printf '%s' "$pid"
}

managed_process() {
  local name="$1" directory="$2" pid cwd
  pid="$(tracked_pid "$name")" || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  cwd="$(/usr/sbin/lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
  [ "$cwd" = "$directory" ]
}

managed_listener() {
  local name="$1" port="$2" directory="$3" pid
  managed_process "$name" "$directory" || return 1
  pid="$(tracked_pid "$name")"
  [ "$pid" = "$(listener_pid "$port")" ]
}

stop_one() {
  local name="$1" port="$2" directory="$3" pid attempt
  if managed_process "$name" "$directory"; then
    pid="$(tracked_pid "$name")"
    kill -TERM "$pid" 2>/dev/null || true
    for ((attempt=0; attempt<30; attempt++)); do
      managed_process "$name" "$directory" || break
      sleep 0.2
    done
    if managed_process "$name" "$directory"; then
      echo "Не удалось остановить $name (PID $pid). Подробности: $RUNTIME/$name.log"
      return 1
    fi
    echo "Остановлен $name."
  elif [ -f "$RUNTIME/$name.pid" ]; then
    echo "У $name нет запущенного процесса, созданного этой кнопкой."
  fi
  rm -f "$RUNTIME/$name.pid"
}

wait_for_listener() {
  local name="$1" port="$2" directory="$3" attempt
  for ((attempt=0; attempt<150; attempt++)); do
    if managed_listener "$name" "$port" "$directory"; then return 0; fi
    if ! kill -0 "$(tracked_pid "$name")" 2>/dev/null; then return 1; fi
    sleep 0.2
  done
  return 1
}

open_site() {
  if [ "${WEBAPP_NO_OPEN:-}" != 1 ]; then
    /usr/bin/open 'http://localhost:5173/' || true
  fi
}

case "${1:-}" in
  start)
    if managed_listener server "$SERVER_PORT" "$SERVER_DIR" && managed_listener client "$CLIENT_PORT" "$CLIENT_DIR"; then
      echo 'WebApp уже запущен: http://localhost:5173/'
      open_site
      exit 0
    fi
    # Recover from an interrupted start, but never touch an unrelated listener.
    for entry in "server:$SERVER_PORT:$SERVER_DIR" "client:$CLIENT_PORT:$CLIENT_DIR"; do
      IFS=: read -r name port directory <<< "$entry"
      if managed_process "$name" "$directory"; then stop_one "$name" "$port" "$directory" || exit 1; fi
      if [ -n "$(listener_pid "$port")" ]; then
        echo "Порт $port уже занят другим процессом. WebApp не запущен."
        exit 1
      fi
      rm -f "$RUNTIME/$name.pid"
    done
    NODE="$(command -v node || true)"
    if [ -z "$NODE" ] || [ ! -f "$CLIENT_DIR/node_modules/vite/bin/vite.js" ] || [ ! -d "$SERVER_DIR/node_modules" ]; then
      echo 'Не найдены Node.js или зависимости проекта. Установите зависимости перед запуском.'
      exit 1
    fi
    echo "Запуск API: $SERVER_PORT"
    cd "$SERVER_DIR" || exit 1
    nohup "$NODE" index.js </dev/null >> "$RUNTIME/server.log" 2>&1 &
    echo "$!" > "$RUNTIME/server.pid"
    if ! wait_for_listener server "$SERVER_PORT" "$SERVER_DIR"; then
      echo "API не запустился. Посмотрите журнал: $RUNTIME/server.log"
      stop_one server "$SERVER_PORT" "$SERVER_DIR" || true
      exit 1
    fi
    echo "Запуск сайта: $CLIENT_PORT"
    cd "$CLIENT_DIR" || exit 1
    nohup "$NODE" node_modules/vite/bin/vite.js --host 127.0.0.1 --port "$CLIENT_PORT" --strictPort </dev/null >> "$RUNTIME/client.log" 2>&1 &
    echo "$!" > "$RUNTIME/client.pid"
    if ! wait_for_listener client "$CLIENT_PORT" "$CLIENT_DIR"; then
      echo "Сайт не запустился. Посмотрите журнал: $RUNTIME/client.log"
      stop_one client "$CLIENT_PORT" "$CLIENT_DIR" || true
      stop_one server "$SERVER_PORT" "$SERVER_DIR" || true
      exit 1
    fi
    echo 'WebApp запущен: http://localhost:5173/'
    open_site
    ;;
  stop)
    stop_one client "$CLIENT_PORT" "$CLIENT_DIR" || exit 1
    stop_one server "$SERVER_PORT" "$SERVER_DIR" || exit 1
    echo 'Локальный WebApp остановлен.'
    ;;
  status)
    for entry in "server:$SERVER_PORT:$SERVER_DIR" "client:$CLIENT_PORT:$CLIENT_DIR"; do
      IFS=: read -r name port directory <<< "$entry"
      if managed_listener "$name" "$port" "$directory"; then
        echo "$name: работает на порту $port"
      elif [ -n "$(listener_pid "$port")" ]; then
        echo "$name: порт $port занят другим процессом"
      else
        echo "$name: остановлен"
      fi
    done
    ;;
  *)
    echo 'Использование: local-webapp.sh start|stop|status'
    exit 2
    ;;
esac
