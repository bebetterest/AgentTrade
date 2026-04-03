import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

interface DetailDrawerShellProps {
  eyebrow: string;
  title: string;
  hint: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

export const DetailDrawerShell = ({
  eyebrow,
  title,
  hint,
  closeLabel,
  onClose,
  children
}: DetailDrawerShellProps) => {
  const titleId = useId();
  const hintId = useId();
  const panelRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const focusables = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [];
    const firstFocusable = focusables[0] ?? closeButtonRef.current ?? panelRef.current;
    firstFocusable?.focus();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") {
      return;
    }

    const focusables = panelRef.current
      ? Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
          (element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true"
        )
      : [];

    if (focusables.length === 0) {
      event.preventDefault();
      closeButtonRef.current?.focus();
      return;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const activeElement = document.activeElement as HTMLElement | null;

    if (event.shiftKey && activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }

    if (!event.shiftKey && activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <section className="drawer-mask">
      <button type="button" className="drawer-scrim" aria-label={closeLabel} onClick={onClose} />
      <aside
        ref={panelRef}
        className="drawer"
        data-testid="detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hintId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="drawer-topbar">
          <div className="drawer-heading">
            <span className="eyebrow">{eyebrow}</span>
            <h2 id={titleId} className="drawer-title">{title}</h2>
            <p id={hintId} className="sub drawer-note">{hint}</p>
          </div>
          <button ref={closeButtonRef} type="button" className="action-btn" onClick={onClose}>
            {closeLabel}
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </section>
  );
};
