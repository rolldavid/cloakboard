export default function DelegationLoading() {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="animate-shimmer">
        <div className="h-7 w-28 bg-background-tertiary rounded-md mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {[1, 2].map((i) => (
            <div key={i} className="bg-card border border-border rounded-md p-4">
              <div className="h-4 w-24 bg-background-tertiary rounded-md mb-2" />
              <div className="h-6 w-32 bg-background-tertiary rounded-md" />
            </div>
          ))}
        </div>
        <div className="bg-card border border-border rounded-md p-5">
          <div className="h-5 w-32 bg-background-tertiary rounded-md mb-4" />
          <div className="h-10 bg-background-tertiary rounded-md mb-3" />
          <div className="h-9 w-28 bg-background-tertiary rounded-md" />
        </div>
      </div>
    </div>
  );
}
