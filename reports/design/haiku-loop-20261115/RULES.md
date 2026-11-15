# 試行のルール（初見の利用者として）
1. 最初に ToolSearch で次を1回で読み込む: "select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__find,mcp__claude-in-chrome__get_page_text,mcp__claude-in-chrome__form_input,mcp__claude-in-chrome__tabs_close_mcp"
2. tabs_context_mcp の後、tabs_create_mcp で新しいタブを作る。作成結果の tabId を控え、以後のすべての操作（navigate・computer・read_page・find など）で必ずその tabId を明示して渡す。tabs_context_mcp に出る他のタブは他の試行者が同時に使っているので、絶対に操作しない。終わったら自分のタブだけ閉じる。
3. ソースコードやリポジトリのファイルを読まない。javascript_tool は使わない。画面の表示と操作だけで進める。
4. 外部サイトへの送信や、alert/confirm などのダイアログを出す操作はしない。印刷ダイアログは開かなくてよい（印刷ボタン・印刷用の画面に到達できれば「印刷できる状態」とみなす）。ファイルの保存ボタンは押してよい。
5. 操作は最大40手。行き詰まったら諦めてよい。
6. 終わったら Write で指定の JSON ファイルに次を書く:
   {"app":"<id>","trial":<n>,"achieved":true|false,"steps":<手数>,"evidence":"達成の根拠（得た値・文面の要約）","stuck":"迷った・詰まった箇所（なければ空）","confusing":["わかりにくかった点を短く"]}
7. 最後の返答は1行だけ:「達成/未達 手数 一言」。
