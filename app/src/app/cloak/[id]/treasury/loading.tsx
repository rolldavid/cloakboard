export default function TreasuryLoading() {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="animate-shimmer">
        <div className="h-7 w-24 bg-background-tertiary rounded-md mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-card border border-border rounded-md p-4">
              <div className="h-4 w-20 bg-background-tertiary rounded-md mb-2" />
              <div className="h-8 w-24 bg-background-tertiary rounded-md" />
            </div>
          ))}
        </div>
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="bg-card border border-border rounded-md p-4">
              <div className="h-4 w-full bg-background-tertiary rounded-md mb-2" />
              <div className="h-4 w-2/3 bg-background-tertiary rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
