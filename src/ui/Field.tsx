import { useEffect, useId, useState, type CSSProperties } from 'react'

export interface FieldProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  /** digits shown in the numeric field */
  precision?: number
  hint?: string
  onPreview: (value: number) => void
  onCommit: () => void
}

/**
 * Slider + numeric entry bound to one runtime parameter. Slider drags preview
 * continuously and commit once (one undo step); typed values apply on Enter/blur.
 */
export function Field({ label, value, min, max, step, unit, precision = 0, hint, onPreview, onCommit }: FieldProps) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const invalid = draft !== null && !isValid(draft, min, max)

  useEffect(() => {
    setDraft(null)
  }, [value])

  const applyDraft = () => {
    if (draft === null) return
    if (isValid(draft, min, max)) {
      onPreview(Number(draft))
      onCommit()
    }
    setDraft(null)
  }

  const fill = ((value - min) / (max - min)) * 100

  return (
    <div className="field">
      <div className="field__head">
        <label htmlFor={`${id}-n`} className="field__label">{label}</label>
        <span className="field__value">
          <input
            id={`${id}-n`}
            className="field__number"
            type="text"
            inputMode="decimal"
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `${id}-err` : hint ? `${id}-hint` : undefined}
            value={draft ?? value.toFixed(precision)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={applyDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyDraft()
              if (e.key === 'Escape') setDraft(null)
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault()
                const delta = (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1)
                onPreview(clamp(value + delta, min, max))
                onCommit()
              }
            }}
          />
          {unit && <span className="field__unit">{unit}</span>}
        </span>
      </div>
      <input
        aria-label={`${label} slider`}
        className="field__range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        onChange={(e) => onPreview(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
      />
      {invalid ? (
        <p id={`${id}-err`} className="field__error" role="alert">Enter a number from {min} to {max}.</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="field__hint">{hint}</p>
      ) : null}
    </div>
  )
}

function isValid(text: string, min: number, max: number): boolean {
  if (text.trim() === '') return false
  const n = Number(text)
  return Number.isFinite(n) && n >= min && n <= max
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}
