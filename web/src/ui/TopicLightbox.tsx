import { useEffect } from "react";
import type { TopicCard } from "../net/types";

interface TopicLightboxProps {
  card: TopicCard | null;
  onClose: () => void;
}

/** Normalizes common YouTube URL forms into the iframe-embeddable form.
 * Other links are passed through as-is — most non-YouTube sites refuse to be
 * iframed (X-Frame-Options/CSP) and there's no generic workaround for that;
 * the iframe just renders blank or an error page for those, which is the
 * browser's own behaviour, not something this app can fix. */
function toEmbeddableUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return `https://www.youtube.com/embed${u.pathname}`;
    if (host === "youtube.com" || host === "m.youtube.com") {
      const id = u.searchParams.get("v");
      if (id) return `https://www.youtube.com/embed/${id}`;
    }
  } catch {
    /* not a valid absolute URL — fall through and use it as typed */
  }
  return url;
}

/** The enlarged view opened by clicking a wall TOPIC board, including the
 * host-featured big board (docs/PLAN.md §一.A "TOPIC 1/2/3" + the featured
 * board) — those are just clickable thumbnails/summaries; this shows the
 * full article, discussion questions, and an embedded link if the host
 * included one. */
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

  const empty = !card.article && !card.embedUrl && (!card.questions || card.questions.length === 0);

  return (
    <div className="lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="lightbox__card" onClick={(e) => e.stopPropagation()}>
        <button className="lightbox__close" onClick={onClose} aria-label="關閉">
          ✕
        </button>
        <h2 className="lightbox__title">{card.title}</h2>
        {card.article && <p className="lightbox__article">{card.article}</p>}
        {card.embedUrl && (
          <div className="lightbox__embed">
            <iframe
              src={toEmbeddableUrl(card.embedUrl)}
              title="話題連結內容"
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              loading="lazy"
            />
          </div>
        )}
        {card.questions && card.questions.length > 0 && (
          <ul className="lightbox__questions">
            {card.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        )}
        {empty && <p className="lightbox__empty">主持人還沒有為這個話題提供更多內容。</p>}
      </div>
    </div>
  );
}
