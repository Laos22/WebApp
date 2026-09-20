# Установка production/Google Drive обновления

Архив нужно распаковывать поверх актуального репозитория WebApp. Он не содержит
`.env`, API-ключей, OAuth-секретов, базы MongoDB и файлов проектов.

## 1. Перейдите в проект и проверьте состояние

```bash
cd "/Users/laos/VS code projects/WebApp"
git status -sb
```

Если есть незакоммиченные изменения, сначала сделайте отдельный commit или резервную
копию. Не продолжайте, пока не понимаете происхождение каждого изменённого файла.

## 2. Распакуйте архив

Замените путь к архиву на реальный путь из Finder:

```bash
unzip -o "/Users/laos/Downloads/WebApp-production-google-drive.zip" \
  -d "/Users/laos/VS code projects/WebApp"
```

Команда не затрагивает существующие `server/.env` и `client/.env`.

## 3. Обновите зависимости

```bash
cd "/Users/laos/VS code projects/WebApp/server"
npm ci

cd "/Users/laos/VS code projects/WebApp/client"
npm ci
```

## 4. Локальный режим

Добавьте или обновите без удаления существующих секретов:

`server/.env`:

```env
AUTH_MODE=developer
STORAGE_PROVIDER=local
```

`client/.env`:

```env
VITE_AUTH_MODE=developer
VITE_SERVER_URL=http://localhost:5001
```

Старые `BYPASS_AUTH` пока поддерживаются для совместимости, но новые переменные
имеют приоритет.

## 5. Проверка

```bash
cd "/Users/laos/VS code projects/WebApp/server"
npm test

cd "/Users/laos/VS code projects/WebApp/client"
npm run build
```

После этого запустите приложение локально и проверьте открытие старого проекта.

## 6. Просмотр и commit

```bash
cd "/Users/laos/VS code projects/WebApp"
git diff --check
git status -sb
git --no-pager diff --stat
```

После ручной проверки:

```bash
git add \
  DEPLOYMENT.md \
  PRODUCTION_UPDATE_INSTALL.md \
  deploy \
  client/.env.example \
  client/package.json \
  client/package-lock.json \
  client/src/context/AuthContext.jsx \
  client/src/pages/CreateProject.jsx \
  client/src/pages/Settings.jsx \
  client/src/services/api.js \
  server/.env.example \
  server/index.js \
  server/package.json \
  server/package-lock.json \
  server/src/config/runtimeConfig.js \
  server/src/middleware/auth.js \
  server/src/models/Project.js \
  server/src/routes/authRoutes.js \
  server/src/routes/projectRoutes.js \
  server/src/services/driveSync.js \
  server/src/services/projectStorageGateway.js \
  server/src/services/storyboardImageStorage.js \
  server/src/services/visualReferenceStorage.js \
  server/src/services/voiceoverStorage.js \
  server/test/scriptPersistence.test.js

git diff --cached --check
git commit -m "Prepare production auth and Google Drive project storage"
git push
```

Не копируйте production `.env` в Git. Пошаговая серверная установка находится в
`DEPLOYMENT.md`.

