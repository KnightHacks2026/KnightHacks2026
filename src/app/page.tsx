export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-xl space-y-4">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">CustodyOS</p>
        <h1 className="text-4xl font-semibold tracking-tight">Platform ready</h1>
        <p className="text-slate-300">
          The application shell is running. Custody workflows will appear as the shared services are connected.
        </p>
      </div>
    </main>
  );
}
