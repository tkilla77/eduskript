# Demo deployment on bottom.ch (spike)

Three parts, all from branch `spike/widget-host`:

| URL | What | Where on the server |
|---|---|---|
| https://bottom.ch/widgets/demo/ | widgets on a plain HTML host page | `/var/www/widgets` (static, `standalone/dist`) |
| https://bottom.ch/dokuwiki/doku.php?id=learning-widgets | widgets in DokuWiki | plugin `lib/plugins/learningwidget`, page `data/pages/learning-widgets.txt` |
| https://eduskript.bottom.ch/tom/learning-widgets/kara | Eduskript itself, same widgets natively (Kara, then Quiz) | Docker container `eduskript-demo` on `127.0.0.1:3100`, Apache vhost `000-0-eduskript.bottom.ch.conf` |

Secrets live in `~/.eduskript-demo/` on the server (mode 600): `postgres.env`
(Postgres password), `app.env` (app environment). Postgres is the
`eduskript-postgres-dev` container on the private Docker network `eduskript`,
published on `127.0.0.1:5432` only; the demo uses database `eduskript_demo`.

## Update

```bash
# on the dev machine (remote "bottom" = bottom.ch:/home/tom/eduskript;
# the server checkout has receive.denyCurrentBranch=updateInstead)
git push bottom spike/widget-host

# widgets
pnpm exec vite build --config standalone/vite.config.ts
rsync -a --delete standalone/dist/ bottom.ch:/var/www/widgets/

# DokuWiki plugin (embed.js is vendored into the plugin)
rsync -a standalone/dokuwiki/learningwidget/ bottom.ch:/var/www/dokuwiki/lib/plugins/learningwidget/
rsync -a standalone/embed/embed.js bottom.ch:/var/www/dokuwiki/lib/plugins/learningwidget/embed.js
```

Eduskript (on the server, in `/home/tom/eduskript`):

```bash
set -a; . ~/.eduskript-demo/app.env; set +a
docker build --secret id=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY,env=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY \
  --build-arg NEXTAUTH_URL=https://eduskript.bottom.ch \
  --build-arg NEXT_PUBLIC_KARA_TILESET_URL=https://bottom.ch/widgets/kara-tiles \
  -t eduskript-demo:spike .
docker rm -f eduskript-demo
docker run -d --name eduskript-demo --restart unless-stopped --network eduskript \
  --env-file ~/.eduskript-demo/app.env -p 127.0.0.1:3100:3000 eduskript-demo:spike
```

First start on an empty database only (both idempotent):

```bash
# Default organisation: without it every path on a non-eduskript.org host is
# a 404 (src/proxy.ts falls back to org "eduskript"), and Next.js caches those
# 404s in the container, so run this before the first request, or recreate
# the container afterwards.
docker exec -w /app eduskript-demo node scripts/seed-org.js
# Owner account + site /tom + "Learning widgets"; locks demo@eduskript.org.
# Prints the new password once: keep it out of logs.
docker cp standalone/eduskript-demo/seed-widgets-demo.mjs eduskript-demo:/app/scripts/
docker exec -w /app eduskript-demo node scripts/seed-widgets-demo.mjs
```

Tileset: `standalone/tools/import-kara-tileset.sh <gameart.zip>` before the
widget build (licensed, never committed; served from /widgets/kara-tiles).

## Logins

Sign in at https://eduskript.bottom.ch/auth/signin → "Sign in with email".

- `tom@scheidweg.net` — owner of site /tom; password in `~/.eduskript-demo/tom-login.txt`.
- `eduadmin@eduskript.org` — password generated on first start, printed in
  `docker logs eduskript-demo`; must be reset on first login.
- `demo@eduskript.org` — created by `scripts/seed-demo.mjs` with the public
  password `demodemo`; locked (random password) by the seed above. Its demo
  content is missing: `seed-demo.mjs` fails on the current schema.

No S3, mail, Microsoft login or AI keys are configured: uploads, email, "Sign in with Microsoft" and AI features fail.

## Take down

```bash
docker rm -f eduskript-demo && docker image rm eduskript-demo:spike
docker exec eduskript-postgres-dev dropdb -U postgres eduskript_demo
rm -rf /var/www/widgets/* /var/www/dokuwiki/lib/plugins/learningwidget /var/www/dokuwiki/data/pages/learning-widgets.txt
sudo a2dissite 000-0-eduskript.bottom.ch && sudo systemctl reload apache2
```
