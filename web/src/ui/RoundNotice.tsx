export interface Notice {
  title: string;
  body?: string;
}

/** A big transient banner ("Round 2 starts — move to table 5"). App owns when
 * it shows and hides. */
export function RoundNotice({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <div className="notice" role="status">
      <div className="notice__title">{notice.title}</div>
      {notice.body && <div className="notice__body">{notice.body}</div>}
    </div>
  );
}
