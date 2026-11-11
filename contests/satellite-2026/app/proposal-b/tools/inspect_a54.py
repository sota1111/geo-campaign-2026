"""A54 の市区町村別件数と先頭1件の項目を表示する（対象自治体を選ぶための補助）。
使い方: python3 -I tools/inspect_a54.py <A54-23_NN.xml>
"""
import collections
import sys
import xml.etree.ElementTree as ET

NS = {"ksj": "http://nlftp.mlit.go.jp/ksj/schemas/ksj-app"}
fs = ET.parse(sys.argv[1]).getroot().findall("ksj:LargeScaleFillSlope", NS)
print(len(fs))
print([(c.tag.split('}')[1], c.text, dict(c.attrib)) for c in fs[0]])
print(collections.Counter(f.find("ksj:localGovernmentName", NS).text for f in fs).most_common(14))
