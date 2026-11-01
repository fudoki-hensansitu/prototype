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

public repo かつ公開サイトなので、実データ・他 repo の中身・個人データは tracked なファイルに入れない。画面の中身はダミーにし、ダミーであることを画面に出す。認証は掛けていないので、見られて困るものを置かない。

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
- [Void](https://void.cloud)（Cloudflare Worker `prototype`）。使い方は `bun install` 後の `node_modules/void/docs/` を読む

## レビュー

PR レビューは Pullfrog。設定の正本は `.github/pullfrog.config.sh`（backend の値は git から見えないので、変えるときはこの script を直して実行する）。model・effort・instructions は org の既定を継承する。public repo なので追加コミットも自動で再レビューし（`review.re-review=true`）、`@pullfrog` で手動依頼もできる。
