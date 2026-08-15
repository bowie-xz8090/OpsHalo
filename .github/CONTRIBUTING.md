# Contributing (OpsHalo)

Thanks for considering a contribution to **OpsHalo**.

This repo is a trimmed fork of [electerm](https://github.com/bowie-xz8090/OpsHalo) focused on **SSH / SFTP / AI Smart Shell / themes**.

## Scope

Please keep changes aligned with Mini goals:

- Prefer SSH / SFTP / AI / theme / sync / settings improvements
- Avoid re-introducing Telnet / Serial / RDP / VNC / Spice / FTP session UIs unless there is an explicit product decision
- Respect `MINI_MODE` in `src/client/common/mini-features.js` and pack slim helpers under `build/bin/mini-slim.js`

For features that belong in the **full** electerm client, contribute upstream instead:

https://github.com/bowie-xz8090/OpsHalo

## Basic process

1. Fork this repository
2. Make your changes
3. Run `npm run lint` (and fix with `npm run fix` if needed)
4. Open a pull request with a clear description of the Mini-relevant change

## Dev quick start

```bash
npm i
npm start          # Vite :5570
npm run app        # Electron
```

See [README.md](../README.md) / [README_cn.md](../README_cn.md) for build & Windows packaging.
