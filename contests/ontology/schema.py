"""キャンペーンのオントロジー（OWL）の定義。`python3 schema.py` で schema.jsonld を書き出す。

名前空間: c:  https://geo-campaign-2026.example/ontology#   （識別子用。実在の URL ではない）
          id: https://geo-campaign-2026.example/id/
人間の関門は Decision の下位クラス（HumanGate）で表し、自動では進めない（doctrine/roe.md）。
"""
import json
from pathlib import Path

from rdflib import Graph, Literal, Namespace, RDF, RDFS, OWL, XSD

C = Namespace("https://geo-campaign-2026.example/ontology#")
ID = Namespace("https://geo-campaign-2026.example/id/")
HERE = Path(__file__).resolve().parent

# (クラス名, 上位, ラベル, 説明)
CLASSES = [
    ("Contest", None, "コンペ", "応募先の大会（registry.json の contests）"),
    ("Division", None, "部門", "コンペ内の部門（イチBiz のビジネス・アイデア・不動産情報活用）"),
    ("Theme", None, "テーマ", "コンペ内のテーマ枠（衛星アワードの協賛企業・共通テーマ1・2）"),
    ("Deadline", None, "締切", "コンペまたは部門の期限"),
    ("Criterion", None, "審査基準", "審査項目"),
    ("Rule", None, "ルール", "失格・無効・注意・未確認など、要項上の条件"),
    ("SubmissionLimit", None, "提出可能数・字数の上限", "1提案まで、欄ごとの字数など"),
    ("App", None, "アプリ・案", "開発物（デモ）と、それに対応する案（Plan）。提出文だけの案も含む"),
    ("Submission", None, "応募", "ある案を、あるコンペ・部門・テーマに出す組み合わせ"),
    ("Fit", None, "適合判定", "アプリ×コンペの適合（◎○△×？とスコア）"),
    ("Dataset", None, "データ", "アプリが使うデータ"),
    ("License", None, "ライセンス・利用条件", "データの利用条件"),
    ("Restriction", None, "制約の種類", "非商用・出典明記・再配布不可など"),
    ("Agent", None, "担い手", "部隊または総司令官"),
    ("Unit", "Agent", "部隊", "CLAUDE.md の部隊編制の 1 部隊"),
    ("Commander", "Agent", "総司令官", "人間。案の選定・提出・registry 変更・ページ削除を決める"),
    ("Stage", None, "標準の流れの段階", "情報部→偵察→[総司令官]→工兵→アグレッサー→作戦研究班→憲兵→[総司令官]"),
    ("StageRecord", None, "段階の完了記録", "ある応募のある段階が済んでいる証拠"),
    ("Task", None, "作業", "進捗一覧にある完了・残作業"),
    ("Decision", None, "判断", "誰かが決めること・決めたこと"),
    ("HumanGate", "Decision", "人間の関門", "総司令官だけが決める。自動では進めない（doctrine/roe.md）"),
    ("SelectionDecision", "HumanGate", "案の選定", "同じ枠に複数の案があるとき、どれを出すか"),
    ("SubmissionDecision", "HumanGate", "提出の判断", "応募フォームへの送信・登録"),
    ("RegistryChange", "HumanGate", "registry.json の変更", "承認後のみ"),
    ("PageDeletion", "HumanGate", "ページ削除", "総司令官の許可が必要（補佐も不可）"),
    ("Escalation", "Decision", "エスカレーション記録", "reports/escalations/ の記録"),
    ("PullRequest", None, "PR", "GitHub の pull request"),
    ("MergeRecord", None, "マージ記録", "reports/command/merge-*.md の 1 行"),
    ("Audit", None, "監査", "憲兵の監査報告（reports/audit/）"),
    ("Blocker", None, "止めているもの", "応募の提出可能を妨げるものの上位クラス"),
    ("Finding", "Blocker", "指摘", "監査の指摘。重大度つき"),
    ("UnfilledField", "Blocker", "未記入欄", "提出文に残る【本人加筆】【提出時に記入】などの穴"),
    ("UnconfirmedDataCondition", "Blocker", "未確認のデータ条件", "データの利用条件が確認できていない"),
    ("MissingDeliverable", "Blocker", "未作成の提出物", "提出文など、あるべき物が無い"),
    ("Severity", None, "重大度", "監査: 失格級・要修正・軽微 ／ デザイン: 重大・中・軽微"),
    ("Source", None, "出典", "ファイルパスと節・行、または URL"),
]

# (プロパティ, 種別 O=Object D=Datatype, ドメイン, レンジ, ラベル)
PROPS = [
    ("hasSource", "O", None, "Source", "出典"),
    ("path", "D", "Source", XSD.string, "ファイルパス"),
    ("locator", "D", "Source", XSD.string, "節・行"),
    ("url", "D", None, XSD.anyURI, "URL"),
    ("note", "D", None, XSD.string, "補足"),
    ("sourceId", "D", None, XSD.string, "元データの識別子"),
    # コンペ
    ("hasDivision", "O", "Contest", "Division", "部門"),
    ("hasTheme", "O", "Contest", "Theme", "テーマ"),
    ("hasDeadline", "O", None, "Deadline", "締切"),
    ("hasCriterion", "O", "Contest", "Criterion", "審査基準"),
    ("hasRule", "O", "Contest", "Rule", "ルール"),
    ("hasSubmissionLimit", "O", "Contest", "SubmissionLimit", "提出可能数・字数"),
    ("ofContest", "O", None, "Contest", "所属コンペ"),
    ("implementationRequired", "D", "Contest", XSD.boolean, "実装必須"),
    ("dueAt", "D", None, None, "期限・日時（時刻の記載がなければ日付だけ）"),
    ("doneAt", "D", "Deadline", XSD.date, "済んだ日"),
    ("description", "D", None, XSD.string, "説明"),
    ("ruleKind", "D", "Rule", XSD.string, "ルールの種類"),
    ("limitKind", "D", "SubmissionLimit", XSD.string, "上限の種類"),
    ("limitField", "D", "SubmissionLimit", XSD.string, "対象の欄"),
    ("limitMax", "D", "SubmissionLimit", XSD.integer, "上限"),
    ("appliesToApp", "O", "Rule", "App", "対象のアプリ"),
    # アプリ・データ
    ("audience", "D", "App", XSD.string, "誰向けか"),
    ("purpose", "D", "App", XSD.string, "使用目的"),
    ("dataKind", "D", "App", XSD.string, "データ種別（実データ・架空・一部架空）"),
    ("planKind", "D", "App", XSD.string, "現行案・新案・提出文のみ"),
    ("appDir", "D", "App", XSD.string, "アプリのディレクトリ"),
    ("demoOf", "O", "App", "App", "デモとして支える案"),
    ("competesWith", "O", "App", "App", "同じ枠で競合する案"),
    ("usesDataset", "O", "App", "Dataset", "使うデータ"),
    ("hasLicense", "O", "Dataset", "License", "ライセンス"),
    ("restricts", "O", "License", "Restriction", "課す制約"),
    ("licenseText", "D", "License", XSD.string, "表の文言"),
    ("conditionStatus", "D", "License", XSD.string, "条件の状態（記載あり・未確認）"),
    ("fitApp", "O", "Fit", "App", "対象アプリ"),
    ("fitTarget", "O", "Fit", None, "対象のコンペまたは部門"),
    ("fitsContest", "O", "App", "Contest", "出せるコンペ（◎○△）"),
    ("mark", "D", "Fit", XSD.string, "◎○△×？"),
    ("score", "D", "Fit", XSD.integer, "スコア（◎3 ○2 △1 ×0 ？0）"),
    ("hasSubmission", "O", "App", "Submission", "応募"),
    # 応募
    ("ofApp", "O", "Submission", "App", "案"),
    ("toContest", "O", "Submission", "Contest", "出すコンペ"),
    ("toDivision", "O", "Submission", "Division", "出す部門"),
    ("toTheme", "O", "Submission", "Theme", "出すテーマ"),
    ("blockedBy", "O", "Submission", "Blocker", "止めているもの"),
    ("awaitsDecision", "O", "Submission", "Decision", "判断待ち"),
    ("slotKey", "D", "Submission", XSD.string, "競合を判定する枠"),
    ("draftFile", "D", "Submission", XSD.string, "提出文のファイル"),
    # 段階
    ("stageOrder", "D", "Stage", XSD.integer, "順序"),
    ("performedBy", "O", "Stage", "Agent", "担当"),
    ("isHumanGate", "D", "Stage", XSD.boolean, "人間の関門"),
    ("ofSubmission", "O", None, "Submission", "応募"),
    ("atStage", "O", "StageRecord", "Stage", "段階"),
    # 作業・判断
    ("assignedTo", "O", "Task", "Agent", "担当"),
    ("forApp", "O", None, "App", "対象のアプリ"),
    ("forSubmission", "O", None, "Submission", "対象の応募"),
    ("status", "D", None, XSD.string, "状態"),
    ("decidedBy", "O", "Decision", "Agent", "決めた人"),
    ("affects", "O", "Blocker", "App", "影響を受けるアプリ"),
    ("overDataset", "O", "UnconfirmedDataCondition", "Dataset", "対象のデータ"),
    # PR・監査
    ("prNumber", "D", "PullRequest", XSD.integer, "PR 番号"),
    ("prState", "D", "PullRequest", XSD.string, "PR の状態"),
    ("headRef", "D", "PullRequest", XSD.string, "ブランチ"),
    ("baseRef", "D", "PullRequest", XSD.string, "ベース"),
    ("mergedAt", "D", "PullRequest", XSD.dateTime, "マージ日時"),
    ("contains", "O", "PullRequest", "App", "含むアプリ"),
    ("mergeRecord", "O", "PullRequest", "MergeRecord", "マージ記録"),
    ("verdict", "D", "MergeRecord", XSD.string, "判定"),
    ("reason", "D", None, XSD.string, "理由"),
    ("auditDate", "D", "Audit", XSD.date, "監査日"),
    ("auditsApp", "O", "Audit", "App", "対象アプリ"),
    ("supersedes", "O", "Audit", "Audit", "置き換える旧版"),
    ("declaredDisqualifying", "D", "Audit", XSD.integer, "報告が宣言する失格級の件数"),
    ("raisedIn", "O", "Finding", "Audit", "指摘された監査"),
    ("severity", "O", "Finding", "Severity", "重大度"),
    ("rawSeverity", "D", "Finding", XSD.string, "報告の見出しにある語（重大・減点級など）"),
    ("certainty", "D", "Finding", XSD.string, "確定・要確認（候補）"),
    ("agentName", "D", "Agent", XSD.string, "agent 名"),
    ("produces", "D", "Unit", XSD.string, "産出物"),
    ("writeScope", "D", "Unit", XSD.string, "書き込み範囲"),
    ("extracted", "D", None, XSD.string, "未抽出の印（値が取り出せなかった）"),
    ("recordedOn", "D", None, XSD.date, "記録日"),
    ("rank", "D", "Severity", XSD.integer, "重さ"),
]

SEVERITIES = [
    ("sev-disqualifying", "失格級", "audit", 3),
    ("sev-fix", "要修正", "audit", 2),
    ("sev-minor", "軽微", "audit", 1),
    ("dsev-major", "重大（デザイン）", "design", 3),
    ("dsev-medium", "中（デザイン）", "design", 2),
    ("dsev-minor", "軽微（デザイン）", "design", 1),
]
RESTRICTIONS = [
    ("NonCommercial", "非商用"),
    ("AttributionRequired", "出典明記"),
    ("ShareAlike", "継承（ODbL）"),
    ("NoRedistribution", "再配布不可"),
    ("CommercialUseAllowed", "商用可"),
]

# 必須の関係の宣言（shapes.ttl が検査する）
FUNCTIONAL = ["severity", "raisedIn", "ofApp", "ofContest"]


def build_schema() -> Graph:
    g = Graph()
    g.bind("c", C)
    g.bind("owl", OWL)
    g.bind("rdfs", RDFS)
    ont = ID["ontology"]
    g.add((ont, RDF.type, OWL.Ontology))
    g.add((ont, RDFS.label, Literal("geo-campaign-2026 オントロジー", lang="ja")))
    g.add((ont, RDFS.comment, Literal("4コンペの応募を自動で進めるための正本スキーマ。人間の関門（HumanGate）は自動で進めない。", lang="ja")))
    for name, sup, label, comment in CLASSES:
        g.add((C[name], RDF.type, OWL.Class))
        g.add((C[name], RDFS.label, Literal(label, lang="ja")))
        g.add((C[name], RDFS.comment, Literal(comment, lang="ja")))
        if sup:
            g.add((C[name], RDFS.subClassOf, C[sup]))
    # 排他: 人間の関門は部隊の作業ではない
    g.add((C.Unit, OWL.disjointWith, C.Commander))
    for name, typ, dom, rng, label in PROPS:
        p = C[name]
        g.add((p, RDF.type, OWL.ObjectProperty if typ == "O" else OWL.DatatypeProperty))
        g.add((p, RDFS.label, Literal(label, lang="ja")))
        if dom:
            g.add((p, RDFS.domain, C[dom]))
        if rng is not None:
            g.add((p, RDFS.range, C[rng] if typ == "O" else rng))
    for name in FUNCTIONAL:
        g.add((C[name], RDF.type, OWL.FunctionalProperty))
    # 重大度・制約の個体
    for sid, label, kind, rank in SEVERITIES:
        g.add((C[sid], RDF.type, C.Severity))
        g.add((C[sid], RDFS.label, Literal(label, lang="ja")))
        g.add((C[sid], C.description, Literal(kind)))
        g.add((C[sid], C.rank, Literal(rank)))
    for rid, label in RESTRICTIONS:
        g.add((C[rid], RDF.type, C.Restriction))
        g.add((C[rid], RDFS.label, Literal(label, lang="ja")))
    return g


def write_schema() -> Path:
    g = build_schema()
    ctx = {
        "c": str(C),
        "id": str(ID),
        "rdfs": str(RDFS),
        "owl": str(OWL),
        "xsd": str(XSD),
    }
    out = HERE / "schema.jsonld"
    out.write_text(g.serialize(format="json-ld", context=ctx, indent=2) + "\n", encoding="utf-8")
    return out


if __name__ == "__main__":
    print(write_schema())
