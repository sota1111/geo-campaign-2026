"""手で決めた対応表（ここだけが「人が書いた事実」）。

正本の md / ts から機械的に取り出せない「どのファイルがどのアプリのものか」だけをここに置く。
各表には根拠（ディレクトリ構成・ファイル名・ファイル冒頭の「対象」行）がある。
build_graph.py はここに書かれたパスが実在することを検査し、無ければ失敗する（古い対応を放置しない）。
値（指摘の中身・数・状態）はここに書かない。
"""

# --- アプリ id → ディレクトリ（contests/<contest>/ 配下。ディレクトリ構成が根拠） -----------------
APP_DIRS = {
    "odpt": "contests/odpt-2026/app",
    "odpt-teiji": "contests/odpt-2026/app-teiji",
    "odpt-kankou": "contests/odpt-2026/app-kankou",
    "odpt-kansui": "contests/odpt-2026/app-kansui",
    "odpt-kodure": "contests/odpt-2026/app-kodure",
    "udc-moritsuchi": "contests/udc-2026/app/moritsuchi-watch",
    "udc-aed": "contests/udc-2026/app/aed-night",
    "sat-a": "contests/satellite-2026/app/proposal-a",
    "sat-b": "contests/satellite-2026/app/proposal-b",
    "sat-alpha": "contests/satellite-2026/app/proposal-alpha",
    "sat-yabu": "contests/satellite-2026/app/proposal-yabu",
    "sat-sugi": "contests/satellite-2026/app/proposal-sugi",
    "biz-business": "contests/ichibiz-2026/app/business",
    "biz-business-nb": "contests/ichibiz-2026/app/business-nb",
    "biz-idea": "contests/ichibiz-2026/app/idea",
    "biz-realestate": "contests/ichibiz-2026/app/realestate",
    "biz-realestate-rn1": "contests/ichibiz-2026/app/realestate-rn1",
    "biz-realestate-a4": "contests/ichibiz-2026/app/realestate-a4",
    "biz-realestate-timeline": "contests/ichibiz-2026/app/realestate-timeline",
    "biz-solar-guard": "contests/ichibiz-2026/app/solar-guard",
}

# registry.ts に無い 6 件の所属コンテスト・部門（ディレクトリの contests/<id>/ と、
# reports/intel/app-contest-fit-20261121.json の「◎」のセルが根拠）。None は「未抽出」。
APP_HOME_FALLBACK = {
    "odpt-kankou": ("odpt-2026", None),
    "odpt-kansui": ("odpt-2026", None),
    "odpt-kodure": ("odpt-2026", None),
    "sat-yabu": ("satellite-2026", None),
    "sat-sugi": ("satellite-2026", None),
    # アイデア部門のみ（reports/command/decision-20261114-solar-guard.md 結論5）
    "biz-solar-guard": ("ichibiz-2026", "idea"),
    # 不動産部門の新案 A4「同じ土地、四つの値段」（dashboard の registry.ts にはまだ無い。reports/audit/ichibiz-2026-realestate-a4-20261121.md の対象）
    "biz-realestate-a4": ("ichibiz-2026", "realestate"),
}

# registry.ts の division 文字列の先頭 → ichibiz の部門 id
DIVISION_PREFIX = [
    ("ビジネス部門", "business"),
    ("アイデア部門", "idea"),
    ("不動産情報活用部門", "realestate"),
]

# --- 衛星アワードのテーマ枠（reports/audit/satellite-2026-alpha-20261113.md F-1、
#     reports/intel/satellite-2026-20261109.md §1-2 要項p6 の例示）。yabu・sugi は未決（None）。 --------
SAT_THEMES = {
    "sponsor": "協賛企業テーマ",
    "common1": "共通テーマ1",
    "common2": "共通テーマ2",
}
SAT_APP_THEMES = {
    "sat-a": ["sponsor", "common1"],
    "sat-b": ["common2"],
    "sat-alpha": ["common2"],
}

# --- 提出文（Submission ごとの記入対象ファイル。ディレクトリ構成が根拠。無い案は提出文未作成） --------
_IZ = "contests/ichibiz-2026/submission"
_FIELDS = ["title", "problem", "service", "background"]
SUBMISSION_FILES = {
    ("odpt", "odpt-2026"): ["contests/odpt-2026/submission/description.md", "contests/odpt-2026/submission/form-draft.md"],
    ("odpt", "udc-2026"): ["contests/udc-2026/submission/entry-1-app.md"],
    ("udc-moritsuchi", "udc-2026"): ["contests/udc-2026/submission/entry-2-idea.md"],
    ("odpt-teiji", "odpt-2026"): ["contests/odpt-2026/submission/description-teiji.md"],
    ("odpt-kodure", "odpt-2026"): ["contests/odpt-2026/submission/description-kodure.md"],
    ("sat-a", "satellite-2026"): ["contests/satellite-2026/submission/proposal-A.md"],
    ("sat-b", "satellite-2026"): ["contests/satellite-2026/submission/proposal-B.md"],
    ("sat-alpha", "satellite-2026"): ["contests/satellite-2026/submission/proposal-alpha.md"],
    ("biz-business", "ichibiz-2026"): [f"{_IZ}/business/{n}.md" for n in _FIELDS + ["market", "challenges"]],
    ("biz-business-nb", "ichibiz-2026"): [f"{_IZ}/business-nb/{n}.md" for n in _FIELDS + ["market", "challenges"]],
    ("biz-idea", "ichibiz-2026"): [f"{_IZ}/idea/{n}.md" for n in _FIELDS],
    ("biz-idea-in1", "ichibiz-2026"): [f"{_IZ}/idea-in1/{n}.md" for n in _FIELDS],
    ("biz-realestate", "ichibiz-2026"): [f"{_IZ}/realestate/{n}.md" for n in _FIELDS + ["reinfolib"]],
    ("biz-realestate-rn1", "ichibiz-2026"): [f"{_IZ}/realestate-rn1/{n}.md" for n in _FIELDS + ["reinfolib"]],
    ("biz-realestate-a4", "ichibiz-2026"): [f"{_IZ}/realestate-a4/{n}.md" for n in _FIELDS + ["reinfolib"]],
    ("biz-realestate-timeline", "ichibiz-2026"): [f"{_IZ}/realestate-timeline/{n}.md" for n in _FIELDS + ["reinfolib"]],
}
# 提出文が無いと確認できる根拠（reports/command/merge-20261121.md PR #36、監査の範囲外の記載）
NO_DRAFT_SOURCES = {
    "sat-yabu": "reports/command/merge-20261121.md",
    "sat-sugi": "reports/command/merge-20261121.md",
    "odpt-kankou": "reports/command/merge-20261121.md",
    "odpt-kansui": "reports/command/merge-20261121.md",
    "biz-solar-guard": "reports/audit/ichibiz-2026-solar-guard-20261113.md",
}
# 未記入の穴の記法（満たしたら消える指示文の括弧）
PLACEHOLDER_RE = r"【(?:本人加筆|総司令官記入|提出時に記入|本人記入)"

# --- 憲兵の監査 → 対象アプリ（各ファイル冒頭の「対象」行が根拠）。supersedes は同一範囲の旧版 -----------
AUDITS = {
    "api-integration-20261112": {"apps": ["odpt", "biz-realestate"], "supersedes": []},
    "api-integration-20261113-r2": {"apps": ["odpt", "biz-realestate"], "supersedes": ["api-integration-20261112"]},
    "dashboard-20261111": {"apps": [], "supersedes": []},  # 統合ダッシュボードの監査（個別の案ではない）
    "ichibiz-2026-20261109": {"apps": ["biz-business", "biz-idea", "biz-realestate"], "supersedes": []},
    "ichibiz-2026-recheck-20261109": {"apps": ["biz-business", "biz-idea", "biz-realestate"], "supersedes": ["ichibiz-2026-20261109"]},
    "ichibiz-2026-business-nb-20261113": {"apps": ["biz-business-nb"], "supersedes": []},
    "ichibiz-2026-realestate-a4-20261121": {"apps": ["biz-realestate-a4"], "supersedes": []},
    "ichibiz-2026-realestate-newplans-20261122": {"apps": ["biz-realestate-timeline", "biz-realestate-rn1"], "supersedes": []},
    "ichibiz-2026-realestate-rn1-20261113": {"apps": ["biz-realestate-rn1"], "supersedes": []},
    "ichibiz-2026-realestate-rn1-regions-20261114": {"apps": ["biz-realestate-rn1"], "supersedes": ["ichibiz-2026-realestate-rn1-20261113"]},
    "ichibiz-2026-solar-guard-20261113": {"apps": ["biz-solar-guard"], "supersedes": []},
    "odpt-2026-20261109": {"apps": ["odpt"], "supersedes": []},
    "odpt-2026-kodure-20261114": {"apps": ["odpt-kodure"], "supersedes": []},
    "odpt-2026-teiji-20261115": {"apps": ["odpt-teiji"], "supersedes": []},
    "satellite-2026-20261109": {"apps": ["sat-a", "sat-b"], "supersedes": []},
    "satellite-2026-proposal-a-realdata-20261121": {"apps": ["sat-a"], "supersedes": []},
    "satellite-2026-a-realdata-20261122": {"apps": ["sat-a"], "supersedes": ["satellite-2026-proposal-a-realdata-20261121"]},
    "satellite-2026-sugi-yabu-20261122": {"apps": ["sat-sugi", "sat-yabu"], "supersedes": []},
    "satellite-2026-alpha-20261113": {"apps": ["sat-alpha"], "supersedes": []},
    "udc-2026-20261109": {"apps": ["odpt", "udc-moritsuchi"], "supersedes": []},
    "udc-2026-aed-20261113": {"apps": ["udc-aed"], "supersedes": []},
}

# 複数アプリを対象にする監査で、指摘の見出しに特定アプリの語があれば、そのアプリだけに付ける。
# 語が無い指摘は全対象アプリに付ける。
AUDIT_APP_TOKENS = {
    "satellite-2026-20261109": {"sat-a": ["提案A"], "sat-b": ["提案B"]},
    "udc-2026-20261109": {"odpt": ["①"], "udc-moritsuchi": ["②"]},
    "ichibiz-2026-20261109": {"biz-business": ["business", "ビジネス"], "biz-idea": ["idea", "アイデア"], "biz-realestate": ["realestate", "不動産"]},
    "ichibiz-2026-recheck-20261109": {"biz-business": ["business", "ビジネス"], "biz-idea": ["idea", "アイデア"], "biz-realestate": ["realestate", "不動産"]},
}

# --- 段階の証拠ファイル（reports/ のファイル名が根拠。実在を検査する） -------------------------------
AGGRESSOR = {
    "odpt": ["odpt-2026-20261109.md"],
    "udc-moritsuchi": ["udc-2026-20261109.md"],
    "udc-aed": ["udc-2026-aed-20261113.md"],
    "sat-a": ["satellite-2026-20261109.md"],
    "sat-b": ["satellite-2026-20261109.md"],
    "sat-alpha": ["satellite-2026-alpha-20261113.md"],
    "biz-business": ["ichibiz-2026-20261109.md"],
    "biz-idea": ["ichibiz-2026-20261109.md"],
    "biz-realestate": ["ichibiz-2026-20261109.md"],
    "biz-business-nb": ["ichibiz-2026-business-nb-20261113.md"],
    "biz-realestate-rn1": ["ichibiz-2026-realestate-rn1-20261113.md"],
    "biz-solar-guard": ["ichibiz-2026-solar-guard-20261113.md"],
    "odpt-teiji": ["odpt-2026-teiji-20261113.md"],
    "odpt-kodure": ["odpt-2026-kodure-20261114.md"],
}
OPS_RESEARCH = {
    "udc-moritsuchi": ["udc-2026-or-20261109.md"],
    "odpt": ["udc-2026-entry1-vs-aed-independent-20261113.md"],
    "udc-aed": ["udc-2026-aed-or-20261113.md"],
    "sat-a": ["satellite-2026-or-20261109.md"],
    "sat-b": ["satellite-2026-or-20261109.md"],
    "sat-alpha": ["satellite-2026-alpha-or-20261113.md"],
    "biz-business": ["ichibiz-2026-or-20261109.md"],
    "biz-idea": ["ichibiz-2026-or-20261109.md"],
    "biz-realestate": ["ichibiz-2026-or-20261109.md"],
    "biz-business-nb": ["ichibiz-2026-business-nb-or-20261113.md"],
    "biz-realestate-rn1": ["ichibiz-2026-realestate-rn1-or-20261113.md"],
}

# --- 標準の流れ（CLAUDE.md「標準の流れ」。順序がそのまま意味） ------------------------------------
STAGES = [
    # id, ラベル, 担当（Unit の agent 名 / "commander"）, 人間の関門か
    ("intel", "要項の事実整理", "intelligence", False),
    ("recon", "案の比較", "recon", False),
    ("select", "案の選定", "commander", True),
    ("build", "実装・提出物の初稿", "engineer", False),
    ("aggress", "弱点・失敗テスト", "aggressor", False),
    ("research", "採点→改善", "operations-research", False),
    ("audit", "要項適合の監査", "military-police", False),
    ("submit", "提出", "commander", True),
]

# --- 進捗一覧（reports/ops/status-*.md）の見出し → (アプリ, 提出先コンテスト) ------------------------
# 正規表現は「### 見出し」に当てる。H2 の （contest-id） が提出先コンテスト。
STATUS_HEADINGS = [
    (r"^作品① 生活アクセス", "odpt", "udc-2026"),
    (r"^作品② みんなの盛土", "udc-moritsuchi", "udc-2026"),
    (r"^作品③ 夜も使えるAED", "udc-aed", None),
    (r"^提案A ", "sat-a", "satellite-2026"),
    (r"^提案B ", "sat-b", "satellite-2026"),
    (r"^新案α", "sat-alpha", "satellite-2026"),
    (r"^ビジネス部門: バス路線", "biz-business", "ichibiz-2026"),
    (r"^ビジネス部門: NB", "biz-business-nb", "ichibiz-2026"),
    (r"^アイデア部門: 地名", "biz-idea", "ichibiz-2026"),
    (r"^アイデア部門: IN1", "biz-idea-in1", "ichibiz-2026"),
    (r"^不動産部門: 相談前", "biz-realestate", "ichibiz-2026"),
    (r"^不動産部門: RN1", "biz-realestate-rn1", "ichibiz-2026"),
    (r"^太陽光発電所の盗難対策", "biz-solar-guard", "ichibiz-2026"),
    (r"^生活アクセス診断マップ（今の案）", "odpt", "odpt-2026"),
    (r"^N2 バス定時性", "odpt-teiji", "odpt-2026"),
    (r"^子連れお出かけ診断", "odpt-kodure", "odpt-2026"),
]

# 部隊名のキーワード → agent（担当の推定。状況報告の文面に出る語が根拠。該当なしは担当「未抽出」）
OWNER_KEYWORDS = [
    ("総司令官", "commander"),
    ("憲兵", "military-police"),
    ("アグレッサー", "aggressor"),
    ("作戦研究班", "operations-research"),
    ("デザイン", "design-reviewer"),
    ("情報部", "intelligence"),
    ("偵察", "recon"),
    ("部隊", "engineer"),
    ("工兵", "engineer"),
]

# --- エスカレーション・補佐の決定 → 関係するアプリ（ファイル名・本文冒頭の「対象」が根拠） -----------
ESCALATION_APPS = {
    "20261109-ichibiz-genai-clause": ["biz-business", "biz-idea", "biz-realestate"],
    "20261109-odpt-center-data": ["odpt"],
    "20261109-satellite-duplicate": ["sat-a", "sat-b"],
    "20261109-satellite-faq7-transcribed": ["sat-a", "sat-b"],
    "20261113-ichibiz-nb-unfilled": ["biz-business-nb"],
    "20261113-ichibiz-realestate-rn1-honnin": ["biz-realestate-rn1"],
    "20261113-satellite-alpha-slot": ["sat-alpha", "sat-b"],
    "20261114-ichibiz-rn1-honnin-kahitsu": ["biz-realestate-rn1"],
    "20261114-odpt-kodure-ksj-noncommercial": ["odpt-kodure"],
    "20261114-solar-guard-data-terms": ["biz-solar-guard"],
    # 統合ダッシュボード自体の指摘（個別の案ではないので案には結ばない）
    "20261121-dashboard-app-steps-hidden": [],
    "20261121-dashboard-detail-collapse": [],
    "20261121-ontology-graph-unreadable": [],
    "20261121-ontology-figures-design": [],
    "20261121-reinfolib-key-hook": [],
    "20261121-aide-gate-relaxation": [],
    "20261121-ichibiz-realestate-a4-honnin": ["biz-realestate-a4"],
    "20261121-ichibiz-a4-kouji-kakaku-niju": ["biz-realestate-a4"],
    "20261122-ichibiz-realestate-newplans-honnin": ["biz-realestate-timeline", "biz-realestate-rn1"],
}
DECISION_APPS = {
    "decision-20261114-odpt-kodure": ["odpt-kodure"],
    "decision-20261114-solar-guard": ["biz-solar-guard"],
}

# --- データの正規化（同じデータを複数のアプリが使うので、名前の揺れを 1 つのノードにまとめる） ----------
# (id, ラベル, 名前+出典に当てる正規表現)。先に合うものを採る。合わなければアプリ固有の Dataset にする。
DATASET_CATALOG = [
    ("osm", "OpenStreetMap", r"OpenStreetMap|OSM|駅・出入口"),
    ("reinfolib", "不動産情報ライブラリ（国土交通省）API", r"不動産情報ライブラリ|XKT|XPT|XIT|立地適正化|将来推計"),
    ("fit-certified", "再エネ事業計画認定情報（資源エネルギー庁）", r"認定情報|事業計画認定"),
    ("ksj-P13", "国土数値情報 都市公園 P13", r"P13"),
    ("ksj-P27", "国土数値情報 文化施設 P27", r"P27"),
    ("ksj-P12", "国土数値情報 観光資源 P12", r"P12"),
    ("ksj-A54", "国土数値情報 大規模盛土造成地 A54", r"A54"),
    ("ksj-A56", "国土数値情報 宅地造成等工事規制区域 A56", r"A56"),
    ("ksj-A29", "国土数値情報 用途地域 A29", r"A29"),
    ("ksj-hospital-school", "国土数値情報 病院・学校（P04・P29）", r"P04|P29|病院・学校|病院・小中学校"),
    ("ksj-N02", "国土数値情報 鉄道駅 N02", r"鉄道駅|N02"),
    ("odpt-gtfs", "公共交通オープンデータ（ODPT センター・GTFS データリポジトリ）", r"GTFS|時刻表|公共交通オープンデータ|ODPT|バスの位置"),
    ("estat-census", "e-Stat 国勢調査（人口・メッシュ）", r"人口|e-Stat|国勢調査|地域メッシュ"),
    ("gsi-hazard", "ハザードマップ（洪水・高潮・浸水想定）", r"洪水|高潮|浸水|ハザード"),
    ("gsi-lore", "自然災害伝承碑（国土地理院）", r"伝承碑"),
    ("gsi-geocode", "国土地理院 住所検索・地名検索 API", r"住所検索|地名検索|設備の位置"),
    ("gsi-tiles", "国土地理院 地理院タイル（背景地図・写真・標高）", r"地理院|背景地図|標準地図|標高"),
    ("sentinel2", "Sentinel-2（Copernicus）", r"Sentinel|衛星（"),
    ("canopy-height", "樹高マップ（Meta・WRI）", r"樹高マップ|Canopy"),
    ("aed-open", "AED 設置の自治体オープンデータ", r"AED"),
    ("bear-sightings", "クマ目撃情報（京都府・BODIK）", r"クマ目撃"),
]
# 行を Dataset にしない（ライブラリ・自作・架空）
DATASET_SKIP_RE = r"^(描画|地図ライブラリ|MapLibre)|見本シート|^地名（|サンプル|^旧地名"

# ライセンスの正規化（表の文言に当てる。複数当たれば複数）。(id, ラベル, 正規表現, 制約[])
LICENSE_CATALOG = [
    ("cc-by-4", "CC BY 4.0", r"CC[ -]?BY\s*4", ["AttributionRequired"]),
    ("cc0", "CC0 1.0", r"CC0", []),
    ("odbl", "ODbL 1.0", r"ODbL", ["AttributionRequired", "ShareAlike"]),
    ("odpt-basic", "公共交通オープンデータ基本ライセンス", r"基本ライセンス", ["AttributionRequired"]),
    ("non-commercial", "非商用（提供元の使用許諾条件）", r"非商用", ["NonCommercial"]),
    ("ksj-terms", "国土数値情報の利用規約", r"国土数値情報の利用規約", ["AttributionRequired"]),
    ("estat-terms", "政府統計の総合窓口（e-Stat）の利用規約", r"e-Stat|政府統計の総合窓口|政府標準", ["AttributionRequired"]),
    ("gsi-terms", "国土地理院コンテンツ利用規約・地理院タイル利用規約", r"国土地理院|地理院タイル利用規約", ["AttributionRequired"]),
    ("copernicus", "Copernicus データの利用条件", r"Copernicus", []),
    ("bsd3", "BSD-3-Clause", r"BSD", []),
    ("fit-terms", "再エネ電子申請サイトの利用規約（認定情報）", r"fit-portal\.go\.jp/Terms|認定情報の利用", ["AttributionRequired"]),
]
# 条件が「未確認」と記録されている状態の語（確認日の「確認」には反応しない）
UNCONFIRMED_RE = r"未確認|確認待ち|確認中|要確認"

# 明示された事実（出典つき）: 利用条件が未確認のデータ。値はファイルの記述そのまま。
UNCONFIRMED_DATA_FACTS = [
    {
        "dataset": "fit-certified",
        "apps": ["biz-solar-guard"],
        "text": "資源エネルギー庁の認定情報の利用ルール（国家・国民の安全に脅威を与える利用の禁止）に当たらないかの確認が未了。期限 2026-12-02 18:00（電話）。",
        "source": "reports/escalations/20261114-solar-guard-data-terms.md",
    },
    {
        "dataset": "reinfolib",
        "apps": ["biz-realestate-rn1"],
        "text": "同梱データ（XKT001〜003・025）の再配布と利用条件が未確認（憲兵 R4）。",
        "source": "reports/audit/ichibiz-2026-realestate-rn1-regions-20261114.md",
    },
]
