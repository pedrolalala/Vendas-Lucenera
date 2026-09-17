// SPEC-153 (2026-09-17): primeiro uso de código de barras no ecossistema
// Lucenera — dependência nova `jsbarcode` adicionada ao `package.json` deste
// sistema (não existe em nenhum outro dos 8 sistemas). Renderiza um SVG
// Code128 de verdade a partir de uma chave (placeholder, sem valor fiscal —
// ver `src/lib/danfe.ts`).
import { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'

interface CodigoBarrasProps {
  value: string
  className?: string
}

export function CodigoBarras({ value, className }: CodigoBarrasProps) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!svgRef.current || !value) return
    try {
      JsBarcode(svgRef.current, value, {
        format: 'CODE128',
        displayValue: false,
        margin: 0,
        height: 40,
        width: 1.3,
      })
    } catch {
      // Chave placeholder pode eventualmente ter tamanho/caractere
      // inesperado -- falha silenciosa, não deve quebrar o espelho da nota.
    }
  }, [value])

  return (
    <svg
      ref={svgRef}
      className={className}
      role="img"
      aria-label={`Código de barras (placeholder, sem valor fiscal): ${value}`}
    />
  )
}
