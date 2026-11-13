// App.tsx — the dashboard's shell (BATON-UI-V2, B-193): the layout every screen mounts inside.
// This ticket builds the shell alone — no sign-in flow, router, polling or controls yet (B-206 to
// B-208), so the page holds the placeholder the owner accepted: "Baton dashboard — sign in".
// Every value the dashboard will draw reaches it as a text node (§12.3); the shell draws none,
// and its words are Baton's own, naming no station, leg or tag.
export function App() {
  return (
    <>
      <header className="shell-head">
        <h1>Baton</h1>
      </header>
      <main>
        <p className="placeholder">Baton dashboard — sign in</p>
        <p className="muted">`baton admin open` or `baton owner open` mints the sign-in link.</p>
      </main>
    </>
  );
}
