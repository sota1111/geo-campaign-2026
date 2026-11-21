import { memo, useEffect, useMemo, useRef } from 'react'
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import { CAT, NODE_H, NODE_W, SHAPE_CLASS, layout, styleOf, type GEdge, type GNode } from '@/lib/ontology'

interface NodeData extends Record<string, unknown> {
  node: GNode
  selected: boolean
  dim: boolean
  impact: boolean
  onSelect: (id: string) => void
}

/** 1つのノード。色（種類のまとまり）・形・記号・種類の言葉・状態の言葉を重ねて示す。押す／Enter で選ぶ */
const OntoNode = memo(function OntoNode({ data }: NodeProps<Node<NodeData>>) {
  const { node, selected, dim, impact, onSelect } = data
  const st = styleOf(node.type)
  const cat = CAT[st.cat]
  return (
    <div style={{ width: NODE_W, height: NODE_H }} className={dim ? 'opacity-40' : ''}>
      <Handle type="target" position={Position.Left} className="!size-1 !min-h-0 !min-w-0 !border-0 !bg-slate-500" isConnectable={false} />
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        aria-pressed={selected}
        aria-label={`${st.label}: ${node.label}${node.status ? `（${node.status}）` : ''}${impact ? '（使えなければ影響を受ける）' : ''}`}
        data-node-id={node.id}
        data-node-type={node.type}
        className={`flex h-full w-full flex-col justify-center overflow-hidden px-2 text-left leading-tight focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${cat.box} ${SHAPE_CLASS[st.shape]} ${selected ? 'ring-4 ring-slate-900 ring-offset-2' : ''} ${impact ? 'outline-4 outline-offset-2 outline-fuchsia-800' : ''}`}
      >
        <span className="flex items-center gap-1 text-[11px] font-bold">
          <span aria-hidden className="shrink-0">{st.symbol}</span>
          <span className="truncate">{st.label}</span>
          {impact && <span className="ml-auto shrink-0 rounded bg-fuchsia-800 px-1 text-white">影響</span>}
        </span>
        <span className="line-clamp-2 text-xs font-semibold">{node.label}</span>
      </button>
      <Handle type="source" position={Position.Right} className="!size-1 !min-h-0 !min-w-0 !border-0 !bg-slate-500" isConnectable={false} />
    </div>
  )
})
const nodeTypes = { onto: OntoNode }

interface Props {
  nodes: GNode[]
  edges: GEdge[]
  selected: string | null
  highlight: Set<string>
  impactOn: boolean
  onSelect: (id: string) => void
  /** 外（一覧・次の行動）で選んだとき、そのノードへ寄せるための合図（id と連番） */
  centerOn: { id: string; n: number } | null
}

function Inner({ nodes, edges, selected, highlight, impactOn, onSelect, centerOn }: Props) {
  const rf = useReactFlow()
  const pos = useMemo(() => layout(nodes, edges), [nodes, edges])
  const idKey = useMemo(() => nodes.map((n) => n.id).sort().join('|'), [nodes])

  const rfNodes: Node<NodeData>[] = useMemo(
    () => nodes.map((n) => ({
      id: n.id,
      type: 'onto',
      position: pos.get(n.id) ?? { x: 0, y: 0 },
      data: { node: n, selected: n.id === selected, dim: impactOn && !highlight.has(n.id) && n.id !== selected, impact: impactOn && highlight.has(n.id), onSelect },
      draggable: false,
      selectable: false,
      focusable: false,
    })),
    [nodes, pos, selected, highlight, impactOn, onSelect],
  )
  const rfEdges: Edge[] = useMemo(
    () => edges.map((e, i) => {
      const hot = selected !== null && (e.source === selected || e.target === selected)
      const dim = impactOn && !(highlight.has(e.source) && highlight.has(e.target))
      return {
        id: `${e.source}|${e.rel}|${e.target}|${i}`,
        source: e.source,
        target: e.target,
        label: hot ? e.label : undefined,
        labelStyle: { fontSize: 11, fontWeight: 700, fill: '#0f172a' },
        labelBgStyle: { fill: '#ffffff', fillOpacity: 0.95 },
        labelBgPadding: [4, 2] as [number, number],
        style: { stroke: hot ? '#0f172a' : '#64748b', strokeWidth: hot ? 2.5 : 1, opacity: dim ? 0.2 : hot ? 1 : 0.7 },
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: hot ? '#0f172a' : '#64748b' },
        focusable: false,
        interactionWidth: 0,
      }
    }),
    [edges, selected, highlight, impactOn],
  )

  // 出すノードの組が変わったら全体に合わせる
  const first = useRef(true)
  useEffect(() => {
    const t = setTimeout(() => void rf.fitView({ padding: 0.12, duration: first.current ? 0 : 250, maxZoom: 1, minZoom: window.innerWidth < 640 ? 0.4 : 0.1 }), 30)
    first.current = false
    return () => clearTimeout(t)
  }, [idKey, rf])
  // 一覧・次の行動で選んだら、そのノードへ寄せる
  useEffect(() => {
    if (!centerOn) return
    const t = setTimeout(() => void rf.fitView({ nodes: [{ id: centerOn.id }], padding: 1.2, duration: 250, maxZoom: 1 }), 60)
    return () => clearTimeout(t)
  }, [centerOn, rf])

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      nodesFocusable={false}
      edgesFocusable={false}
      elementsSelectable={false}
      minZoom={0.15}
      maxZoom={1.5}
      zoomOnScroll={false}
      preventScrolling={false}
      panOnScroll={false}
      fitView
      proOptions={{ hideAttribution: false }}
      aria-label="つながり図。ノードを選ぶと詳細がカードに出ます。キーボードでは、ノードの一覧からも選べます"
    >
      <Background gap={24} color="#cbd5e1" />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}

export function GraphView(props: Props) {
  return (
    <ReactFlowProvider>
      <div className="h-full w-full">
        <Inner {...props} />
      </div>
    </ReactFlowProvider>
  )
}
