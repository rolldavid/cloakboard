export default function FeedLoading() {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="animate-shimmer">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="h-7 w-20 bg-background-tertiary rounded-md" />
            <div className="h-4 w-32 bg-background-tertiary rounded-md mt-2" />
          </div>
          <div className="h-9 w-24 bg-background-tertiary rounded-md" />
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-card border border-border rounded-md p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 bg-background-tertiary rounded-full" />
                <div className="h-4 w-32 bg-background-tertiary rounded-md" />
              </div>
              <div className="space-y-2">
                <div className="h-4 bg-background-tertiary rounded-md w-full" />
                <div className="h-4 bg-background-tertiary rounded-md w-3/4" />
              </div>
              <div className="flex gap-4 mt-4">
                <div className="h-4 w-12 bg-background-tertiary rounded-md" />
                <div className="h-4 w-12 bg-background-tertiary rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
