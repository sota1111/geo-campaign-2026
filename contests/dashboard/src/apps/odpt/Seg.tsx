import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export interface SegOption<T extends string | number> { value: T; label: string }

/** 1つだけ選べるボタン群（選択中は塗りつぶし＋チェックで色以外でも区別できる） */
export function Seg<T extends string | number>({
  label, options, value, onChange,
}: { label: string; options: SegOption<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      spacing={1}
      value={String(value)}
      aria-label={label}
      className="flex-wrap justify-start"
      onValueChange={(v) => {
        const o = options.find((x) => String(x.value) === v)
        if (o) onChange(o.value)
      }}
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={String(o.value)}
          value={String(o.value)}
          className="h-9 px-3 text-sm data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:font-bold"
        >
          {String(o.value) === String(value) ? '✓ ' : ''}{o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
