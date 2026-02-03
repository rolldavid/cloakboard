export default function AgentsLoading() {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="animate-shimmer">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="h-7 w-20 bg-background-tertiary rounded-md" />
            <div className="h-4 w-36 bg-background-tertiary rounded-md mt-2" />
          </div>
          <div className="h-9 w-28 bg-background-tertiary rounded-md" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-card border border-border rounded-md p-4">
              <div className="h-8 w-12 bg-background-tertiary rounded-md mb-2" />
              <div className="h-4 w-24 bg-background-tertiary rounded-md" />
            </div>
          ))}
        </div>
        <div className="bg-card border border-border rounded-md p-5 mb-6">
          <div className="h-5 w-24 bg-background-tertiary rounded-md mb-3" />
          <div className="flex items-center gap-3">
            <div className="h-6 w-40 bg-background-tertiary rounded-md" />
            <div className="h-5 w-16 bg-background-tertiary rounded-full" />
          </div>
        </div>
        <div className="bg-card border border-border rounded-md p-5">
          <div className="h-5 w-56 bg-background-tertiary rounded-md mb-4" />
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3">
                <div className="w-7 h-7 bg-background-tertiary rounded-full flex-shrink-0" />
                <div className="flex-1 space-y-1">
                  <div className="h-4 w-40 bg-background-tertiary rounded-md" />
                  <div className="h-3 w-64 bg-background-tertiary rounded-md" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
