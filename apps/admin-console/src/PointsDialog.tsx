import { useEffect, useId, useRef, type ReactNode } from 'react';

export function PointsDialog({ title, closeLabel, onClose, children }: { title: string; closeLabel: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus(); };
  }, []);
  return <dialog className="points-dialog" ref={ref} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2 id={titleId}>{title}</h2><button type="button" onClick={onClose}>{closeLabel}</button></header>
    <div className="points-dialog-body">{children}</div>
  </dialog>;
}
