# Demo deployment on bottom.ch (spike)

Three parts, all from branch `spike/widget-host`:

| URL | What | Where on the server |
|---|---|---|
| https://bottom.ch/widgets/demo/ | widgets on a plain HTML host page | `/var/www/widgets` (static, `standalone/dist`) |
| https://bottom.ch/dokuwiki/doku.php?id=learning-widgets | widgets in DokuWiki | plugin `lib/plugins/learningwidget`, page `data/pages/learning-widgets.txt` |
| https://eduskript.bottom.ch/demo | Eduskript itself, same widgets natively | Docker container `eduskript-demo` on `127.0.0.1:3100`, Apache vhost `000-0-eduskript.bottom.ch.conf` |

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
  --build-arg NEXTAUTH_URL=https://eduskript.bottom.ch -t eduskript-demo:spike .
docker rm -f eduskript-demo
docker run -d --name eduskript-demo --restart unless-stopped --network eduskript \
  --env-file ~/.eduskript-demo/app.env -p 127.0.0.1:3100:3000 eduskript-demo:spike
docker cp standalone/eduskript-demo/seed-widgets-demo.mjs eduskript-demo:/app/scripts/
docker exec -w /app eduskript-demo node scripts/seed-widgets-demo.mjs
```

## Logins

- `demo@eduskript.org` / `demodemo` — the demo teacher from `scripts/seed-demo.mjs`.
  The password is public (it is in the repo): anyone can edit the demo content.
- `eduadmin@eduskript.org` — password generated on first start, printed in
  `docker logs eduskript-demo`.

No S3, mail or AI keys are configured: uploads, email and AI features fail.

## Take down

```bash
docker rm -f eduskript-demo && docker image rm eduskript-demo:spike
docker exec eduskript-postgres-dev dropdb -U postgres eduskript_demo
rm -rf /var/www/widgets/* /var/www/dokuwiki/lib/plugins/learningwidget /var/www/dokuwiki/data/pages/learning-widgets.txt
sudo a2dissite 000-0-eduskript.bottom.ch && sudo systemctl reload apache2
```
