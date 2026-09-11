import { useEffect, useRef, useState, type FormEvent } from "react";

export interface ChatEntry {
  id: string;
  name: string;
  body: string;
  ts: number;
  self: boolean;
}

interface ChatProps {
  messages: ChatEntry[];
  onSend: (body: string) => void;
}

/** Room text chat: message list + composer. Phase 1 — in-memory only, no
 * history persistence yet (see docs/PLAN.md §三 Phase 1). */
export function Chat({ messages, onSend }: ChatProps) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    onSend(body);
    setDraft("");
  };

  return (
    <div className="chat">
      <div className="chat__list" ref={listRef}>
        {messages.map((m) => (
          <div
            key={`${m.id}-${m.ts}`}
            className={`chat__msg${m.self ? " chat__msg--self" : ""}`}
          >
            <span className="chat__name">{m.name}</span>
            <span className="chat__body">{m.body}</span>
          </div>
        ))}
      </div>
      <form className="chat__form" onSubmit={submit}>
        <input
          className="chat__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="對這個房間說些什麼…"
          maxLength={500}
        />
        <button className="chat__send" type="submit">
          送出
        </button>
      </form>
    </div>
  );
}
