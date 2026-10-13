export function ComingSoon({ title, milestone }: { title: string; milestone: string }) {
  return (
    <div className="card">
      <h1>{title}</h1>
      <p className="muted">This tool arrives in milestone {milestone}. Load and tag your deck on the Decks page in the meantime.</p>
    </div>
  );
}
