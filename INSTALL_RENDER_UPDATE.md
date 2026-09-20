# Установка обновления Render

Архив подготовлен поверх коммита `a1cd712` ветки
`feature/webapp-script-persistence`.

## 1. Проверка проекта

```bash
cd "/Users/laos/VS code projects/WebApp"
git status -sb
```

Перед заменой файлов рабочее дерево должно быть чистым.

## 2. Распаковка

Если архив сохранён в `Downloads`, выполните:

```bash
unzip -o "$HOME/Downloads/WebApp-render-deployment.zip" -d "/Users/laos/VS code projects/WebApp"
```

Архив содержит только изменённые и новые файлы. Остальные файлы проекта он не
удаляет.

## 3. Проверка

```bash
cd "/Users/laos/VS code projects/WebApp/server"
npm test
```

```bash
cd "/Users/laos/VS code projects/WebApp/client"
npm run build
```

```bash
cd "/Users/laos/VS code projects/WebApp"
git diff --check
git status -sb
```

## 4. Коммит

После успешных проверок:

```bash
git add \
  client/src/hooks/useGenerateTopic.js \
  client/src/pages/CoverGen.jsx \
  client/src/pages/CreateProject.jsx \
  client/src/pages/ProjectWorkspace.jsx \
  client/src/pages/Projects.jsx \
  client/src/pages/ScriptGen.jsx \
  client/src/services/api.js \
  client/src/services/profileService.js \
  server/.env.example \
  server/index.js \
  server/src/config/database.js \
  server/src/config/runtimeConfig.js \
  render.yaml \
  RENDER_DEPLOYMENT.md \
  INSTALL_RENDER_UPDATE.md
```

```bash
git --no-pager diff --cached --check
git commit -m "Prepare Render deployment with Google Drive storage"
git push
git status -sb
```

После отправки коммита выполняйте настройку сервисов по файлу
`RENDER_DEPLOYMENT.md`.
