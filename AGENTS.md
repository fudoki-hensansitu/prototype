# prototype

議員・行政向け AI エージェントの画面を試す場所。実際に触ってもらい、その画面の方向で作るかどうかを決められれば、その PoC の役目は終わる。

## ディレクトリ構造

```
.
├── <poc>/              # PoC ごとのコード
├── docs/<poc>/         # その PoC で何を作り何を確かめるか
├── routes/             # Void の route。`routes/<poc>/index.ts` が `/<poc>` を配る
├── home/index.html     # `/` の PoC 一覧
└── void.config.ts      # Worker 名と入口（prototype.fudoki.dev）
```

PoC はコードと docs を同名の dir で切る。PoC を足すときは次を揃える。

1. `<poc>/` にコードを置き、`routes/<poc>/index.ts` で配る
2. `docs/<poc>/README.md` に、何を作り何を確かめるかを書く
3. `home/index.html` の一覧に足す

検索エンジンに載せないため、`void.config.ts` の `routing.headers` が全レスポンスに `X-Robots-Tag: noindex` を付け、`public/robots.txt` が全 path を Disallow する。HTML を足すときは `<head>` に `<meta name="robots" content="noindex, nofollow, noarchive">` も入れる。

画面は Cloudflare Access の背後に置くが、repo は public なのでコードは誰でも読める。実データ・他 repo の中身・個人データは tracked なファイルに入れない。画面の中身はダミーにし、ダミーであることを画面に出す。

## セットアップ

ツールは mise で管理している。

```bash
mise install
mise exec -- bun install
mise exec -- bun run dev     # vite dev
mise exec -- bun run check   # 型検査
```

deploy の手順は README を見る。lint とテストは持たない。

依存は exact ピン留めにし、公開から7日未満の版は `bunfig.toml`（`minimumReleaseAge`）で解決から外す。セキュリティ修正は cooldown の例外として直ちに入れ、例外を解除できる日時を PR 本文に書く。

## 技術スタック

- Bun + TypeScript
- [Void](https://void.cloud)（Cloudflare Worker `prototype`）。`void.lock.json` は Void が生成したら commit する

## Skills

- Void でアプリを作る・CLI を使うとき → `.agents/skills/void/`（`voidzero-dev/void` から skillctrl で取得。取得元と hash は `skills-lock.json`・`.agents/skillctrl/`）。Claude Code へは `.claude/skills/` の相対 symlink で渡す

## レビュー・計測

- PR レビューは Pullfrog。PR の merge で Pullfrog を待たなくてよい。設定の正本は `.github/pullfrog.config.sh`（backend の値は git から見えないので、変えるときはこの script を直して実行する）。model・effort・instructions は org の既定を継承する
- agent session の trace を Langfuse に送る。opt-in の file は gitignore 済みなので、`orca.yaml` の setup が新しい worktree へ同期する。新しい checkout では `pi install -l --approve "git:github.com/wwwyo/pi-observability-plugin@v0.2.0"` をやり直す
