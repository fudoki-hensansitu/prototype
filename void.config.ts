import { defineConfig } from 'void/config';

export default defineConfig({
  worker: {
    compatibility_date: '2026-10-18',
  },
  // 試作は検索エンジンに載せない。全レスポンスに付けるので、後から足す PoC にも効く。
  routing: {
    headers: {
      '/*': ['X-Robots-Tag: noindex, nofollow, noarchive'],
    },
  },
  cloudflare: {
    name: 'prototype',
    account_id: '0f82b8922b8393c603b89b58c7b9d169',
    // 入口は Access で守る prototype.fudoki.dev だけにする。workers.dev と Version URL は閉じる。
    routes: [{ pattern: 'prototype.fudoki.dev', custom_domain: true }],
    workers_dev: false,
    preview_urls: false,
    limits: { cpu_ms: 100 },
    observability: { enabled: true },
  },
});
