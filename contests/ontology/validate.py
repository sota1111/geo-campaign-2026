#!/usr/bin/env python3
"""campaign.jsonld（と schema.jsonld）を shapes.ttl（SHACL）で検査する。

  python3 contests/ontology/validate.py            # Violation があれば exit 1
  python3 contests/ontology/validate.py --graph path.jsonld
Warning は「未抽出」の可視化で、失敗にしない。
"""
import argparse
import sys
from pathlib import Path

from pyshacl import validate
from rdflib import Graph, Namespace, RDF
from rdflib.namespace import SH

HERE = Path(__file__).resolve().parent
C = Namespace("https://geo-campaign-2026.example/ontology#")


def load(graph_path=None):
    g = Graph()
    g.parse(HERE / "schema.jsonld", format="json-ld")
    g.parse(graph_path or HERE / "campaign.jsonld", format="json-ld")
    return g


def run(graph_path=None):
    g = load(graph_path)
    shapes = Graph().parse(HERE / "shapes.ttl", format="turtle")
    conforms, rg, _ = validate(g, shacl_graph=shapes, inference="none", allow_warnings=True, advanced=True)
    viol, warn = [], []
    for r in rg.subjects(RDF.type, SH.ValidationResult):
        sev = rg.value(r, SH.resultSeverity)
        item = (str(rg.value(r, SH.focusNode)).replace("https://geo-campaign-2026.example/id/", "id:"), str(rg.value(r, SH.resultMessage)))
        (warn if sev == SH.Warning else viol).append(item)
    return viol, warn


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--graph")
    args = ap.parse_args()
    viol, warn = run(args.graph)
    for f, m in viol:
        print(f"VIOLATION {f}: {m}")
    from collections import Counter

    for m, n in Counter(m for _, m in warn).most_common():
        print(f"warning x{n}: {m}")
    print(f"違反 {len(viol)} 件 / 警告 {len(warn)} 件")
    sys.exit(1 if viol else 0)


if __name__ == "__main__":
    main()
