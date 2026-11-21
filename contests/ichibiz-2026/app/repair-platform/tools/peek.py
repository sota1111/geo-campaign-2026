"""複数メッシュで、建築年・階数・延床・用途の属性が入っているかを数える（調査用）。
python3 -I tools/peek.py 53394645 53393476 ...  （メッシュ番号を並べる。無指定なら先頭の数ファイル）"""
import collections
import os
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from remotezip import open_zip  # noqa: E402

KEYS = {"usage", "yearOfConstruction", "storeysAboveGround", "storeysBelowGround", "totalFloorArea", "buildingStructureType", "class", "yearOfDemolition", "measuredHeight", "buildingFootprintArea", "address", "name", "buildingRoofEdgeArea"}
z = open_zip()
infos = [i for i in z.infolist() if "/bldg/" in i.filename and i.filename.endswith(".gml")]
want = [a for a in sys.argv[1:] if not a.startswith("--every=")]
every = [int(a.split("=")[1]) for a in sys.argv[1:] if a.startswith("--every=")]
sel = [i for i in infos if any(f"/{m}_" in i.filename for m in want)] if want else (infos[:: every[0]] if every else infos[1:4])
for info in sel:
    cnt = collections.Counter()
    n = 0
    with z.open(info.filename) as f:
        for ev, el in ET.iterparse(f, events=("end",)):
            t = el.tag.split("}")[1]
            if t == "Building":
                n += 1
                el.clear()
            elif t in KEYS and (el.text or "").strip():
                cnt[t] += 1
    print(info.filename.split("/")[-1], "buildings", n, dict(cnt))
