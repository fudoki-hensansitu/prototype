# prototype

議員・行政向け AI エージェントの画面の試作を置く repo です。中身はダミーで、実際のデータや AI にはつながっていません。

https://prototype.fudoki.dev/ （Cloudflare Access でログインが要ります）

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

`main` に merge すると [deploy workflow](.github/workflows/deploy.yml) が型検査のあと deploy します（Actions の画面から手動でも起動できます）。repo の Actions に次を置いておく必要があります。

- secret `CLOUDFLARE_API_TOKEN`: Workers Scripts: Edit と、`fudoki.dev` の Workers Routes: Edit を持つ token
- variable `CLOUDFLARE_WORKERS_SUBDOMAIN`: アカウントの workers.dev サブドメイン（`xxx` または `xxx.workers.dev`）。preview URL が使えないときの、新しい checkout からの readiness 確認に要る

手元から deploy するときは次の手順です。Cloudflare への接続（`void connect --platform cloudflare`）は clone ごとに 1 回必要です（`.void/` は gitignore）。

```bash
mise exec -- bun run check
mise exec -- bunx void deploy --platform cloudflare
curl -fsS https://prototype.fudoki.dev/__void/ready
```

環境に secret の環境変数があると、build が `dist/ssr/.dev.vars` に平文で書きます（upload はされません）。deploy する shell には `CLOUDFLARE_*` などの secret を入れないでください。

## Access（コードの外で管理）

`void deploy` は Access application を作りません。Cloudflare の Zero Trust に次の 3 つを置いています。

- `prototype`（domain `prototype.fudoki.dev`）: policy `Cloudflare account members`。Cloudflare アカウントのメンバーだけが開ける
- `prototype /__void/ready`（domain `prototype.fudoki.dev/__void/ready`）: policy `Bypass everyone (wwwyo-apps readiness)`。`void deploy` の readiness check 用で、消すと deploy が切り替わらない
- `prototype previews`（Worker の Access「Previews only」）: policy `Cloudflare account members`。PR 確認用の preview URL を守る。消すと preview が誰でも開ける

merge 前の変更は、本番を切り替えずに名前付きの preview URL（preview alias）で確認できます。PR を作るか push すると [preview workflow](.github/workflows/preview.yml) が `pr-<番号>` の preview を upload し、URL を PR にコメントします（`CLOUDFLARE_API_TOKEN` が要ります）。

メンバー以外に見せるときは、`prototype` に相手を許可する policy を足します。
