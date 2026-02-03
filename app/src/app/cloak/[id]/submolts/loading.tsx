export default function SubmoltsLoading() {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="animate-shimmer">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="h-7 w-24 bg-background-tertiary rounded-md" />
            <div className="h-4 w-28 bg-background-tertiary rounded-md mt-2" />
          </div>
          <div className="h-9 w-28 bg-background-tertiary rounded-md" />
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-card border border-border rounded-md p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-7 w-12 bg-background-tertiary rounded" />
                <div>
                  <div className="h-4 w-28 bg-background-tertiary rounded-md" />
                  <div className="h-3 w-36 bg-background-tertiary rounded-md mt-1" />
                </div>
              </div>
              <div className="h-4 w-20 bg-background-tertiary rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
