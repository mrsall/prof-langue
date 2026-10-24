"use client";

import { useCallback, useRef } from "react";

/**
 * Gros bouton « maintiens pour parler ». Appelle `onHoldChange(true)` tant que
 * le doigt reste appuyé, `onHoldChange(false)` quand il relâche (ou si le
 * doigt sort du bouton, ou si le téléphone coupe l'appui).
 */
export function PushToTalkButton({
  holding,
  disabled,
  interrupting,
  onHoldChange,
}: {
  holding: boolean;
  disabled?: boolean;
  /** L'IA parle : appuyer va l'interrompre. */
  interrupting?: boolean;
  onHoldChange: (holding: boolean) => void;
}) {
  const pointerId = useRef<number | null>(null);

  const release = useCallback(() => {
    if (pointerId.current == null) return;
    pointerId.current = null;
    onHoldChange(false);
  }, [onHoldChange]);

  const press = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (disabled || pointerId.current != null) return;
      pointerId.current = e.pointerId;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      onHoldChange(true);
    },
    [disabled, onHoldChange],
  );

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <button
        type="button"
        disabled={disabled}
        aria-pressed={holding}
        aria-label={holding ? "Je t'écoute, relâche pour envoyer" : "Maintiens pour parler"}
        onPointerDown={press}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if ((e.key === " " || e.key === "Enter") && !e.repeat && !disabled) {
            e.preventDefault();
            onHoldChange(true);
          }
        }}
        onKeyUp={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            onHoldChange(false);
          }
        }}
        style={{ touchAction: "none", WebkitUserSelect: "none" }}
        className={`grid h-28 w-28 place-items-center rounded-full transition-all duration-150 disabled:opacity-50 ${
          holding
            ? "scale-110 bg-listening text-fg shadow-[0_0_0_14px_rgba(255,160,92,0.22)]"
            : interrupting
              ? "border-[3px] border-speaking bg-elevated text-fg"
              : "bg-accent text-accent-contrast shadow-lg shadow-accent/40"
        }`}
      >
        <svg
          aria-hidden="true"
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      </button>
      <span className="text-sm font-semibold text-muted">
        {holding ? "Je t'écoute… relâche pour envoyer" : "Maintiens pour parler"}
      </span>
    </div>
  );
}
