export default function ProposalsLoading() {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="animate-shimmer">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="h-7 w-28 bg-background-tertiary rounded-md" />
            <div className="h-4 w-24 bg-background-tertiary rounded-md mt-2" />
          </div>
          <div className="h-9 w-32 bg-background-tertiary rounded-md" />
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-card border border-border rounded-md p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="h-5 w-48 bg-background-tertiary rounded-md" />
                <div className="h-5 w-16 bg-background-tertiary rounded-full" />
              </div>
              <div className="h-4 bg-background-tertiary rounded-md w-full mb-2" />
              <div className="h-4 bg-background-tertiary rounded-md w-2/3" />
              <div className="flex gap-4 mt-4">
                <div className="h-8 w-20 bg-background-tertiary rounded-md" />
                <div className="h-8 w-20 bg-background-tertiary rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
