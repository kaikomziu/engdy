# Engdy（いんぐてぃー） v1.4.0

英単語を学んで、定着させる学習アプリ。かるわかGAMES。
https://kaikomziu.github.io/engdy/

## できること
- **リスト制作**：単語を1行に1つ（`apple, りんご` のように意味も書ける）。意味は Gemini で自動入力もできる。`.engdy` ファイルで保存・読み込み、Supabase で公開（全体公開・パスワード・URL限定）。
- **閲覧**：単語 →（タップ or 数秒）→ 意味 →（タップ or 数秒）→ 次。60秒操作がないと一時停止し、放置時間は記録しない。
- **統計**：放置を除いた学習時間・見た単語・テストの記録。
- **テストモード**：閲覧で見た単語から4択。苦手な単語ほど出やすい。
- **専属エージェント**：テスト60問・15語で解放。Gemini と苦手な単語を予習。
- **自由メモ**：ページを増やせる手書きノート（ペン・蛍光ペン・消しゴム・定規・まる・四角・文字）。
- **スタンプカード／ガチャ**：毎日1周でスタンプ＆ダイヤ。ガチャで図鑑・背景・テーマ。
- **保護者メール**：AgentMail で毎週日曜 19:00 に1週間の記録を送る（停止・解除可）。
- **admin**：かるわかGAMES 管理者だけ。Gemini / AgentMail のキーなどを設定。

## しくみ
- 静的サイト（GitHub Pages）。ES Modules、ビルドなし。`js/app.js` が入口。
- アカウント：かるわかGAMES SDK（`data-game="engdy"`、`engdy_v1` と `engdy_lists` をクラウド同期）。
- 暗号化（`js/crypto.js`）：JSON → Base64 → AES-256-GCM → `ENGDY1:K:`＋Base64。パスワード付きリストは PBKDF2 でパスワードから鍵を作る（`ENGDY1:P:`）。
- Supabase（kifnzvktwbomxthzvvgy）：`engdy_*` テーブル（RLS で全拒否、RPC だけで操作）。メールアドレスと API キーは Vault のマスター鍵で暗号化。
- Edge Function `engdy-api`（`supabase/functions/engdy-api`）：Gemini と AgentMail の中継。キーはブラウザに出さない。週次メールは pg_cron（`engdy-weekly`）から呼ぶ。

## 素材
- 効果音：OtoLogic（CC BY 4.0）、効果音ラボ
- BGM：ふぁいの音楽置き場（fai-musics）

作者：かるわか ／ コード：Claude AI（Anthropic）
