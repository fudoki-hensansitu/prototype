# prototype

議員・行政向け AI エージェントの画面の試作を置く repo です。中身はダミーで、実際のデータや AI にはつながっていません。

https://prototype.fudoki.dev/

| PoC | 画面 | 確かめたいこと |
| --- | --- | --- |
| giin-agent | [/giin-agent](https://prototype.fudoki.dev/giin-agent) | [docs/giin-agent](docs/giin-agent/README.md) |

## QuickStart

```bash
mise install
mise exec -- bun install
mise exec -- bun run dev
```

## Deploy

自動 deploy は張っていません。`main` の内容を手元から deploy します。Cloudflare への接続（`void connect --platform cloudflare`）は clone ごとに 1 回必要です（`.void/` は gitignore）。

```bash
mise exec -- bun run check
mise exec -- bunx void deploy --platform cloudflare
curl -sS -o /dev/null -w '%{http_code}\n' https://prototype.fudoki.dev/giin-agent
```

環境に secret の環境変数があると、build が `dist/ssr/.dev.vars` に平文で書きます（upload はされません）。deploy する shell には `CLOUDFLARE_*` などの secret を入れないでください。
