# Первый production-деплой на DigitalOcean Droplet

Целевая схема: Ubuntu Droplet, Nginx и HTTPS на одном домене, React как статические
файлы, Node.js на локальном порту 5001, отдельная production MongoDB и Google Drive
каждого пользователя.

## 1. До начала

Понадобятся:

- домен или поддомен, направленный A-записью на IP Droplet;
- Ubuntu 24.04 LTS Droplet, рекомендуется минимум 2 vCPU / 4 GB RAM;
- отдельная production MongoDB;
- OAuth Client типа Web application в Google Cloud;
- включённый Google Drive API.

На сервере должен быть установлен Node.js 22. Перед установкой приложения проверьте:

```bash
node --version
npm --version
```

Google callback:

```text
https://app.example.com/auth/callback
```

## 2. Production env

Создайте `/etc/ai-hub/server.env` вне Git:

```env
NODE_ENV=production
PORT=5001
AUTH_MODE=google
STORAGE_PROVIDER=google_drive
VITE_CLIENT_URL=https://app.example.com
VITE_SERVER_URL=https://app.example.com
MONGODB_URI=mongodb+srv://REPLACE_ME/aihub_production
SESSION_SECRET=REPLACE_ME
ENCRYPTION_KEY=REPLACE_ME
GOOGLE_CLIENT_ID=REPLACE_ME
GOOGLE_CLIENT_SECRET=REPLACE_ME
SESSION_COOKIE_SAME_SITE=lax
MAX_FLOW_ARCHIVE_MB=100
```

Секреты можно создать командами:

```bash
openssl rand -base64 48
openssl rand -base64 48
```

`ENCRYPTION_KEY` нельзя менять после сохранения ключей и OAuth-токенов.

Для frontend build создайте `client/.env.production`:

```env
VITE_SERVER_URL=https://app.example.com
VITE_AUTH_MODE=google
```

## 3. Установка приложения

Выполняйте от отдельного sudo-пользователя, не от root:

```bash
sudo adduser --system --group --home /opt/ai-hub aihub
sudo mkdir -p /opt/ai-hub /var/www/ai-hub /etc/ai-hub
sudo chown -R "$USER":aihub /opt/ai-hub /var/www/ai-hub
git clone YOUR_REPOSITORY_URL /opt/ai-hub
cd /opt/ai-hub/server
npm ci --omit=dev
cd ../client
npm ci
npm run build
sudo rsync -a --delete dist/ /var/www/ai-hub/
```

Не копируйте локальные `.env`, `server/uploads` и локальную базу данных.

## 4. systemd

Скопируйте `deploy/aihub.service.example`:

```bash
sudo cp /opt/ai-hub/deploy/aihub.service.example /etc/systemd/system/aihub.service
sudo chown root:root /etc/ai-hub/server.env
sudo chmod 600 /etc/ai-hub/server.env
sudo systemctl daemon-reload
sudo systemctl enable --now aihub
sudo systemctl status aihub
```

Логи:

```bash
sudo journalctl -u aihub -f
```

## 5. Nginx и HTTPS

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
sudo cp /opt/ai-hub/deploy/nginx.conf.example /etc/nginx/sites-available/aihub
sudo ln -s /etc/nginx/sites-available/aihub /etc/nginx/sites-enabled/aihub
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d app.example.com
```

Перед командами замените `app.example.com` в Nginx и env на реальный домен.

## 6. Проверка

```bash
curl https://app.example.com/api/health
```

Далее проверьте в браузере:

1. вход через Google;
2. статус Google Drive в настройках;
3. создание проекта и папок `AI Hub/Projects/...`;
4. сохранение сценария, аудио, референса и изображения;
5. повторный вход и чтение файлов;
6. удаление тестового проекта.

## Обновление

```bash
cd /opt/ai-hub
git pull --ff-only
cd server && npm ci --omit=dev
cd ../client && npm ci && npm run build
sudo rsync -a --delete dist/ /var/www/ai-hub/
sudo systemctl restart aihub
curl https://app.example.com/api/health
```
