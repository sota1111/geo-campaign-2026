"""オントロジーの検査。実行: python3 -m pytest contests/ontology/tests -q （requirements.txt が必要）"""
import datetime as dt
import json
import sys
from pathlib import Path

import pytest

rdflib = pytest.importorskip("rdflib")
pytest.importorskip("pyshacl")

HERE = Path(__file__).resolve().parents[1]
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))

from rdflib import Graph, Literal, Namespace, RDF, RDFS, URIRef  # noqa: E402

import build_graph  # noqa: E402
import graph_json  # noqa: E402
import next_actions as NA  # noqa: E402
import validate  # noqa: E402
from tsliteral import parse_array  # noqa: E402

C = Namespace("https://geo-campaign-2026.example/ontology#")
ID = Namespace("https://geo-campaign-2026.example/id/")
NOW = dt.datetime(2026, 11, 21, tzinfo=NA.JST)


@pytest.fixture(scope="module")
def g():
    return NA.load_graph()


# ---------------- 生成（正本 → グラフ）
def test_ts_literal_parser_reads_registry():
    apps = parse_array((ROOT / "contests/dashboard/src/apps/registry.ts").read_text(encoding="utf-8"), "APPS")
    assert len(apps) >= 12 and apps[0]["id"] == "odpt" and apps[0]["contest"] == "odpt-2026"


def test_build_runs_offline_and_counts(tmp_path):
    b, _ = build_graph.build(offline=True)
    g2 = b.g
    n = lambda cls: len(set(g2.subjects(RDF.type, C[cls])))  # noqa: E731
    assert n("Contest") == 4 and n("Division") == 3 and n("Theme") == 3
    assert n("App") >= 18 and n("Submission") >= 18
    assert n("Finding") > 50 and n("Audit") == len(list((ROOT / "reports/audit").glob("*.md")))
    assert n("PullRequest") >= 37 and n("Unit") == 10


def test_committed_graph_is_loadable_and_has_registry_deadlines(g):
    # registry.json の締切が Deadline に入っている（正本から生成されている）
    reg = json.loads((ROOT / "contests/registry.json").read_text(encoding="utf-8"))
    ats = {str(o) for o in g.objects(None, C.dueAt)}
    for c in reg["contests"]:
        for d in c["deadlines"]:
            assert d["at"] in ats


# ---------------- 検証（SHACL）
def test_shacl_conforms():
    viol, _warn = validate.run()
    assert viol == [], viol[:5]


def _validate_with(tmp_path, extra):
    g = validate.load()
    for t in extra:
        g.add(t)
    p = tmp_path / "bad.jsonld"
    (g).serialize(destination=str(p), format="json-ld")
    return validate.run(str(p))[0]


def test_shacl_rejects_app_without_source(tmp_path):
    x = ID["app/_no_source"]
    viol = _validate_with(tmp_path, [(x, RDF.type, C.App), (x, RDFS.label, Literal("出典なし", lang="ja")), (x, C.sourceId, Literal("x"))])
    assert any("出典" in m for _, m in viol)


def test_shacl_rejects_finding_without_severity(tmp_path):
    x = ID["finding/_bad"]
    src = next(iter(Graph().parse(HERE / "campaign.jsonld", format="json-ld").subjects(RDF.type, C.Source)))
    viol = _validate_with(
        tmp_path,
        [(x, RDF.type, C.Finding), (x, RDFS.label, Literal("重大度なし", lang="ja")), (x, C.hasSource, src), (x, C.raisedIn, ID["audit/odpt-2026-20261109"])],
    )
    assert any("重大度" in m for _, m in viol)


def test_shacl_rejects_automated_human_gate(tmp_path):
    d = ID["decision/_auto"]
    src = next(iter(Graph().parse(HERE / "campaign.jsonld", format="json-ld").subjects(RDF.type, C.Source)))
    viol = _validate_with(
        tmp_path,
        [(d, RDF.type, C.SubmissionDecision), (d, RDFS.label, Literal("自動で提出", lang="ja")), (d, C.status, Literal("決定")),
         (d, C.hasSource, src), (d, C.decidedBy, ID["unit/engineer"])],
    )
    assert any("人間の関門" in m for _, m in viol)


def test_every_source_path_exists(g):
    missing = []
    for s in g.subjects(RDF.type, C.Source):
        p = g.value(s, C.path)
        if p is not None and not str(p).startswith("総司令官の指示") and not (ROOT / str(p)).exists():  # 口頭の指示はファイルではない
            missing.append(str(p))
    assert not missing, sorted(set(missing))


def test_every_finding_has_severity_and_source(g):
    for f in g.subjects(RDF.type, C.Finding):
        assert g.value(f, C.severity) is not None and g.value(f, C.hasSource) is not None, f


# ---------------- 人間の関門
def test_human_gates_belong_to_commander(g):
    q = """PREFIX c: <https://geo-campaign-2026.example/ontology#>
    ASK { ?s c:isHumanGate true ; c:performedBy ?p . FILTER NOT EXISTS { ?p a c:Commander } }"""
    assert not g.query(q).askAnswer
    q2 = """PREFIX c: <https://geo-campaign-2026.example/ontology#>
    ASK { ?d a c:SelectionDecision ; c:decidedBy ?p . FILTER NOT EXISTS { ?p a c:Commander } }"""
    assert not g.query(q2).askAnswer
    gate_types = {"SelectionDecision", "SubmissionDecision", "RegistryChange", "PageDeletion"}
    for t in gate_types:
        assert (C[t], RDFS.subClassOf, C.HumanGate) in g


# ---------------- 問い合わせ
def test_q1_readiness_covers_all_submissions_and_none_is_auto_ready(g):
    rows = NA.q(g, "q1_readiness")
    assert len(rows) == len(set(g.subjects(RDF.type, C.Submission)))
    assert {r["readiness"] for r in rows} <= {"提出不可", "要修正あり", "未監査", "選定待ち", "提出可能な状態"}
    # 失格級・未記入欄・データ条件・提出文なし のどれかがあれば、必ず「提出不可」
    for r in rows:
        if int(r["disqualifying"]) + int(r["unfilled"]) + int(r["dataCondition"]) + int(r["missingDraft"]) > 0:
            assert r["readiness"] == "提出不可"


def test_q1_ready_state_on_synthetic_submission(g, tmp_path):
    """ブロッカーも未決もない応募は「提出可能な状態」、失格級を足すと「提出不可」になる。"""
    from copy import deepcopy

    g2 = Graph()
    for t in g:
        g2.add(t)
    s = ID["sub/_synthetic"]
    g2.add((s, RDF.type, C.Submission))
    g2.add((s, RDFS.label, Literal("合成の応募", lang="ja")))
    g2.add((s, C.ofApp, ID["app/odpt"]))
    g2.add((s, C.toContest, ID["contest/odpt-2026"]))
    r = ID["stagerec/_synthetic/audit"]
    g2.add((r, C.ofSubmission, s))
    g2.add((r, C.atStage, ID["stage/audit"]))
    rows = {x["sub"]: x for x in NA.q(g2, "q1_readiness")}
    assert rows[str(s)]["readiness"] == "提出可能な状態"
    f = ID["finding/_synthetic/D1"]
    g2.add((f, RDF.type, C.Finding))
    g2.add((f, C.severity, C["sev-disqualifying"]))
    g2.add((s, C.blockedBy, f))
    rows = {x["sub"]: x for x in NA.q(g2, "q1_readiness")}
    assert rows[str(s)]["readiness"] == "提出不可"


def test_q3_next_stage_is_after_last_done(g):
    rows = NA.q(g, "q3_next_stage")
    assert rows
    for r in rows:
        assert int(r["maxDone"]) < len(build_graph.M.STAGES)
    # 人間の関門の段階は必ず総司令官
    for r in rows:
        if r["human"] == "true":
            assert r["unit"].endswith("/commander")


def test_q4_pending_decisions_are_human_gates_only(g):
    rows = NA.q(g, "q4_pending_decisions")
    assert rows
    for r in rows:
        assert r["type"].split("#")[-1] in {"SelectionDecision", "SubmissionDecision", "RegistryChange", "PageDeletion", "HumanGate"}


def test_q5_data_impact_for_noncommercial_dataset(g):
    rows = NA.q(g, "q5_data_impact", dataset=str(ID["dataset/ksj-P13"]))
    assert {r["app"].split("/")[-1] for r in rows} == {"odpt-kodure"}
    assert any("odpt-2026" in (r.get("contest") or "") for r in rows)
    risky = {r["dataset"].split("/")[-1] for r in NA.q(g, "q5b_risky_datasets")}
    assert {"ksj-P13", "ksj-P27", "ksj-P12"} <= risky


def test_q6_fit_has_mark_and_score(g):
    rows = NA.q(g, "q6_fit")
    assert len(rows) >= 100
    score = {"◎": 3, "○": 2, "△": 1, "×": 0, "？": 0}
    for r in rows:
        assert score[r["mark"]] == int(r["score"])


# ---------------- 次の行動
def test_next_actions_report(g):
    rep = NA.build_report(g, NOW)
    json.dumps(rep, ensure_ascii=False)
    assert rep["submissions"] and rep["commanderDecisions"]
    # 部隊ごとの作業は締切の近い順（締切未抽出は後ろ）
    for acts in rep["unitActions"].values():
        dues = [a["due"] for a in acts if a["due"]]
        assert dues == sorted(dues)
    # 「提出」「案の選定」を commander 以外の部隊に割り当てていない
    for ag, acts in rep["unitActions"].items():
        if ag != "commander":
            assert not any("（総司令官の判断" in a["action"] for a in acts)
    md = NA.to_md(rep, NA.unit_labels(g))
    assert "## 1." in md and "## 3. 総司令官の判断待ち" in md


def test_next_actions_cli_json(tmp_path):
    import subprocess

    out = tmp_path / "n.json"
    subprocess.run([sys.executable, str(HERE / "next_actions.py"), "--now", "2026-11-21", "--out-json", str(out), "--out-md", str(tmp_path / "n.md")], check=True)
    d = json.loads(out.read_text(encoding="utf-8"))
    assert d["asOf"] == "2026-11-21" and d["submissions"]


# ---------------- 画面用 JSON
def test_graph_json_is_consistent(g):
    d = graph_json.build(g, NOW)
    ids = [n["id"] for n in d["nodes"]]
    assert len(ids) == len(set(ids))
    idset = set(ids)
    for e in d["edges"]:
        assert e["source"] in idset and e["target"] in idset
    for n in d["nodes"]:
        assert n["type"] in d["legend"] and n["label"]
        if n["type"] in ("App", "Finding", "Submission", "Contest"):
            assert n["sources"], n["id"]
    kinds = {n["type"] for n in d["nodes"]}
    assert {"Contest", "App", "Submission", "Dataset", "Finding", "Task", "PullRequest", "Unit"} <= kinds
    marks = {e["props"]["mark"] for e in d["edges"] if e["rel"] == "fit"}
    assert marks <= {"◎", "○", "△", "×", "？"}


# ---------------- 画面用 next-actions.json（ダッシュボードが読む）
def test_ui_json_points_to_graph_nodes(g):
    import ui_json

    rep = ui_json.build(NOW)
    ids = {n["id"] for n in graph_json.build(g, NOW)["nodes"]}
    assert rep["submissions"] and rep["dataImpactAll"] and rep["unitLabels"]
    for s in rep["submissions"]:
        assert {s["submission"], s["app"], s["contest"]} <= ids
    for d in rep["commanderDecisions"]:
        assert d["decision"] in ids, d["decision"]  # HumanGate も画面のノードになる
    for ds, v in rep["dataImpactAll"].items():
        assert ds in ids and set(v["apps"]) <= ids
    for acts in rep["unitActions"].values():
        for a in acts:
            assert a["app"] is None or a["app"] in ids  # 代理マージなど、アプリに結ばない作業は None


# ---------------- 代理マージ（総司令官 2026-11-21 の指示）
def test_merge_delegation_rule_in_graph(g):
    rule = ID["rule/merge-delegation"]
    assert (rule, RDF.type, C.DelegationRule) in g
    assert (rule, C.delegatedTo, ID["unit/commander-aide"]) in g
    assert next(g.objects(rule, C.approvalRequired)).toPython() is False
    srcs = " ".join(str(g.value(s, C.path)) for s in g.objects(rule, C.hasSource))
    assert "総司令官の指示" in srcs and "CLAUDE.md" in srcs
    cond = str(g.value(rule, C.condition))
    assert "CI" in cond and "registry" in cond and "競合" in cond and "秘密情報" in cond and "ページ削除" in cond
    assert "止めないが、残っていれば記録し、提出可能・完成とは報告しない" in cond  # 確定した SOP
    assert "最新の監査に失格級が残る" not in cond and "最新のデザイン審査に重大が残る" not in cond
    note = str(g.value(rule, C.note))
    assert "PR #46" in note and "確認待ち" not in note  # 確認待ちの注記は外れている
    urls = " ".join(str(o) for s in g.objects(rule, C.hasSource) for o in g.objects(s, C.url))
    assert "/pull/46" in urls and "以降は指示なしでも代理でマージ" in " ".join(str(g.value(s, C.locator)) for s in g.objects(rule, C.hasSource))
    assert len(list(g.objects(rule, C.hasSource))) >= 4


def test_shacl_rejects_merge_delegation_assigned_to_other(tmp_path):
    t = ID["mergedelegation/_bad"]
    src = next(iter(Graph().parse(HERE / "campaign.jsonld", format="json-ld").subjects(RDF.type, C.Source)))
    viol = _validate_with(
        tmp_path,
        [(t, RDF.type, C.MergeDelegation), (t, RDFS.label, Literal("代理マージ", lang="ja")), (t, C.status, Literal("open")), (t, C.hasSource, src),
         (t, C.assignedTo, ID["unit/engineer"]), (t, C.forPullRequest, ID["pr/1"]), (t, C.delegationRule, ID["rule/merge-delegation"])],
    )
    assert any("総司令官補佐" in m for _, m in viol)


def test_open_pr_becomes_aide_action_not_commander_decision():
    t = ID["mergedelegation/999"]
    pr = ID["pr/999"]
    g2 = NA.load_graph()
    src = next(iter(g2.subjects(RDF.type, C.Source)))
    for tr in [(pr, RDF.type, C.PullRequest), (pr, RDFS.label, Literal("#999 テスト", lang="ja")), (pr, C.prNumber, Literal(999)), (pr, C.prState, Literal("OPEN")),
               (t, RDF.type, C.MergeDelegation), (t, RDF.type, C.Task), (t, RDFS.label, Literal("代理マージの判断: #999", lang="ja")), (t, C.status, Literal("open")),
               (t, C.description, Literal("x")), (t, C.hasSource, src), (t, C.assignedTo, ID["unit/commander-aide"]), (t, C.forPullRequest, pr),
               (t, C.delegationRule, ID["rule/merge-delegation"])]:
        g2.add(tr)
    rep = NA.build_report(g2, NOW)
    assert any("PR #999" in a["action"] for a in rep["unitActions"].get("commander-aide", []))
    assert not any("999" in d["decision"] or "999" in d["label"] for d in rep["commanderDecisions"])
    assert not any("999" in x["text"] for v in rep["statusTasksByAgent"].values() for x in v)


def test_data_impact_has_no_duplicate_submissions():
    import ui_json

    rep = ui_json.build(NOW)
    for v in rep["dataImpactAll"].values():
        keys = [(s["submission"], s["contest"], s["division"]) for s in v["submissions"]]
        assert len(keys) == len(set(keys))


def test_decisions_are_merged_per_status_list_row(g):
    """同じコンペ・同じ判断は 1 件（進捗一覧の「判断待ち」の行）。案の選定の関門・応募ごとの判断は includes に畳む"""
    rep = NA.build_report(g, NOW)
    ds = rep["commanderDecisions"]
    rows = [d for d in ds if d["decision"].startswith("id:decision/status/list-")]
    assert len(rows) == len(ds), "一覧の行に当たらない判断が単独で残っている"
    folded = [i["decision"] for d in ds for i in d["includes"]]
    assert len(folded) == len(set(folded))
    assert any(i.startswith("id:decision/select/") for i in folded)
    # 畳んだものも畳まないものも、元の未決の判断を取りこぼさない
    q4 = {"id:" + r["decision"][len(str(ID)):] for r in NA.q(g, "q4_pending_decisions")}
    assert q4 == {d["decision"] for d in ds} | set(folded)


# ---------------- 提出予定数（総司令官 2026-11-21 の指示。要項の上限 SubmissionLimit とは別）
def test_planned_submissions_in_graph_and_ui_json(g):
    import ui_json

    p = ui_json.build(NOW)["plannedSubmissions"]
    assert p["satellite-2026"] == {"total": 2, "parts": {"スポンサー": 1, "一般": 1}}
    assert p["ichibiz-2026"] == {"total": 3, "parts": {"ビジネス": 1, "アイデア": 1, "不動産": 1}}
    assert "udc-2026" not in p and "odpt-2026" not in p  # 指示なし。数を作らない
    assert not set(g.subjects(RDF.type, C.PlannedSubmission)) & set(g.subjects(RDF.type, C.SubmissionLimit))
