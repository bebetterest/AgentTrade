"use client";

import { useRouter } from "next/navigation";

interface HistoryBackButtonProps {
  label: string;
  fallbackHref: string;
  className?: string;
}

export const HistoryBackButton = ({ label, fallbackHref, className }: HistoryBackButtonProps) => {
  const router = useRouter();

  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        if (window.history.length > 1) {
          router.back();
          return;
        }
        router.push(fallbackHref);
      }}
    >
      {label}
    </button>
  );
};
