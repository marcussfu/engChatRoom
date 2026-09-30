import { useEffect } from "react";
import type { TopicCard } from "../net/types";

interface TopicLightboxProps {
  card: TopicCard | null;
  onClose: () => void;
}

/** The enlarged view opened by clicking a wall TOPIC board (docs/PLAN.md
 * §一.A "TOPIC 1/2/3") — the board itself is just a clickable thumbnail
 * (title only); this shows the full article and discussion questions. */
export function TopicLightbox({ card, onClose }: TopicLightboxProps) {
  useEffect(() => {
    if (!card) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, onClose]);

  if (!card) return null;

  return (
    <div className="lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="lightbox__card" onClick={(e) => e.stopPropagation()}>
        <button className="lightbox__close" onClick={onClose} aria-label="關閉">
          ✕
        </button>
        <h2 className="lightbox__title">{card.title}</h2>
        {card.article && <p className="lightbox__article">{card.article}</p>}
        {card.questions && card.questions.length > 0 && (
          <ul className="lightbox__questions">
            {card.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        )}
        {!card.article && (!card.questions || card.questions.length === 0) && (
          <p className="lightbox__empty">主持人還沒有為這個話題提供更多內容。</p>
        )}
      </div>
    </div>
  );
}
