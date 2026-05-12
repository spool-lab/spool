import { useCallback, useRef, useState, type DragEvent } from 'react'

type Options = {
  enabled: boolean
  onImport: (file: File) => void | Promise<void>
}

/** Drag-and-drop intake for `.spool` files. Tracks an isDragActive flag
 *  that flips on only when the user is dragging files (not in-document
 *  drags), so the consumer can show a drop overlay without false
 *  positives from text/element dragging. */
export function useSpoolDrop({ enabled, onImport }: Options) {
  const [isDragActive, setIsDragActive] = useState(false)
  // dragenter / dragleave fire per nested element, so a depth counter
  // is needed to know when the drag has truly left the target.
  const depthRef = useRef(0)

  const isFileDrag = (event: DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files')

  const onDragEnter = useCallback(
    (event: DragEvent) => {
      if (!enabled || !isFileDrag(event)) return
      event.preventDefault()
      depthRef.current += 1
      setIsDragActive(true)
    },
    [enabled],
  )

  const onDragOver = useCallback(
    (event: DragEvent) => {
      if (!enabled || !isFileDrag(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    },
    [enabled],
  )

  const onDragLeave = useCallback(
    (event: DragEvent) => {
      if (!enabled || !isFileDrag(event)) return
      event.preventDefault()
      depthRef.current = Math.max(0, depthRef.current - 1)
      if (depthRef.current === 0) setIsDragActive(false)
    },
    [enabled],
  )

  const onDrop = useCallback(
    (event: DragEvent) => {
      if (!enabled || !isFileDrag(event)) return
      event.preventDefault()
      depthRef.current = 0
      setIsDragActive(false)
      const files = Array.from(event.dataTransfer?.files ?? [])
      const spool = files.find((f) => f.name.toLowerCase().endsWith('.spool'))
      if (spool) void onImport(spool)
    },
    [enabled, onImport],
  )

  return {
    isDragActive,
    dragHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
  }
}
