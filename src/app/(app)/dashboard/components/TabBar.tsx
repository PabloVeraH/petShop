type DashboardTab = "analitica" | "reportes";

interface TabBarProps {
  active: DashboardTab;
  onChange: (tab: DashboardTab) => void;
}

const TABS: { id: DashboardTab; label: string; icon: string }[] = [
  { id: "analitica", label: "Analítica", icon: "📊" },
  { id: "reportes", label: "Reportes", icon: "📋" },
];

export function TabBar({ active, onChange }: TabBarProps) {
  return (
    <div className="flex border-b border-gray-200 mb-6 gap-0">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`
            flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors border-b-2
            ${active === tab.id
              ? "border-green-600 text-green-700"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }
          `}
        >
          <span>{tab.icon}</span>
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export type { DashboardTab };