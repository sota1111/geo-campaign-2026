import { useMemo, useState } from 'react'
import { getApp } from '@/apps/registry'
import { PageHeader } from './PageHeader'
import { MapView, type MapLayer } from './MapView'
import { SourceDialog } from './SourceDialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

/** 実装前の仮ページ。各工兵は自分の src/apps/<id>/index.tsx を本実装で置き換える。
 *  共通部品（PageHeader / MapView / SourceDialog）の使用例も兼ねる。 */
export function Placeholder({ appId }: { appId: string }) {
  const app = getApp(appId)
  const [clicked, setClicked] = useState<string>('地図をクリックすると経度・緯度が出ます')
  const layers = useMemo<MapLayer[]>(
    () => [
      {
        id: 'demo-point',
        type: 'circle',
        data: {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [139.7671, 35.6812] } }],
        },
      },
    ],
    [],
  )
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader
        appId={appId}
        actions={
          <SourceDialog
            sources={[
              {
                name: '国土地理院タイル（淡色・標準・写真）',
                provider: '国土地理院',
                url: 'https://maps.gsi.go.jp/development/ichiran.html',
                license: '国土地理院コンテンツ利用規約（出典の表示が必要）',
              },
            ]}
          />
        }
      />
      <Alert>
        <AlertTitle>準備中</AlertTitle>
        <AlertDescription>
          このページは実装中です。元の静的版は
          <code className="mx-1 rounded bg-muted px-1">{app?.originalPath}</code>
          にあります。下の地図は共通部品 MapView の動作確認用です。
        </AlertDescription>
      </Alert>
      <MapView
        center={[139.7671, 35.6812]}
        zoom={9}
        layers={layers}
        onClick={(p) => setClicked(`経度 ${p.lng.toFixed(5)}、緯度 ${p.lat.toFixed(5)}`)}
        className="h-[320px]"
      />
      <p className="text-sm text-muted-foreground" data-testid="clicked">
        {clicked}
      </p>
    </div>
  )
}
