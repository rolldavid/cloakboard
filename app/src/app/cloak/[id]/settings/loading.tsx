export default function SettingsLoading() {
  return (
    <div className="py-8 px-4">
      <div className="max-w-4xl mx-auto animate-shimmer">
        <div className="h-4 w-32 bg-background-tertiary rounded-md mb-6" />
        <div className="h-8 w-24 bg-background-tertiary rounded-md mb-8" />
        <div className="bg-card border border-border rounded-md p-6 space-y-6">
          <div>
            <div className="h-4 w-28 bg-background-tertiary rounded-md mb-2" />
            <div className="h-4 w-full bg-background-tertiary rounded-md mb-3" />
            <div className="flex gap-3">
              <div className="flex-1 h-10 bg-background-tertiary rounded-md" />
              <div className="h-10 w-16 bg-background-tertiary rounded-md" />
            </div>
          </div>
          <div className="border-t border-border pt-6">
            <div className="h-4 w-28 bg-background-tertiary rounded-md mb-2" />
            <div className="h-4 w-full bg-background-tertiary rounded-md" />
          </div>
        </div>
      </div>
    </div>
  );
}
