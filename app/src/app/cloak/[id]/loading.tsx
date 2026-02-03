export default function CloakOverviewLoading() {
  return (
    <div className="animate-shimmer space-y-6">
      <div className="grid grid-cols-2 gap-4">
        {[1, 2].map((i) => (
          <div key={i} className="h-24 bg-background-tertiary rounded-md" />
        ))}
      </div>
      <div className="h-64 bg-background-tertiary rounded-md" />
    </div>
  );
}
