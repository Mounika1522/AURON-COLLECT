import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

export default function DashboardCharts({
  ageingChartData,
  bgCard,
  bgSurface,
  darkMode,
  dashboardDateRangeLabel,
  dashboardTrendData,
  formatDashboardCurrency,
  prefersReducedMotion,
  selectedDashboardCurrency,
  textMuted,
  visibleAgeing
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className={`min-w-0 p-5 rounded-2xl border ${bgCard} lg:col-span-2`}>
        <div className="flex items-center justify-between mb-4 gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold">Net Billed vs. Collected Recovery Trend</h3>
            <p className={`text-xs ${textMuted}`}>
              Invoice amounts less approved credits and allocated receipts in {selectedDashboardCurrency || "selected currency"}
            </p>
          </div>
          <span className={`shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-semibold ${bgSurface}`}>
            {dashboardDateRangeLabel}
          </span>
        </div>
        <div className="h-64 w-full min-w-0">
          {dashboardTrendData.some((entry) => entry.billed !== 0 || entry.collected !== 0) ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dashboardTrendData}>
                <defs>
                  <linearGradient id="billedGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#E50914" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#E50914" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="collGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? "#222" : "#eee"} />
                <XAxis dataKey="month" stroke="#808080" fontSize={11} />
                <YAxis
                  stroke="#808080"
                  fontSize={11}
                  tickFormatter={(value) => `${selectedDashboardCurrency} ${(value / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: darkMode ? "#171717" : "#fff",
                    borderColor: "#333",
                    borderRadius: "10px",
                    fontSize: "12px"
                  }}
                  formatter={(value) => formatDashboardCurrency(value, selectedDashboardCurrency)}
                />
                <Area
                  type="monotone"
                  dataKey="billed"
                  stroke="#E50914"
                  strokeWidth={2}
                  fill="url(#billedGrad)"
                  name="Net Billed"
                  isAnimationActive={!prefersReducedMotion}
                  animationDuration={450}
                />
                <Area
                  type="monotone"
                  dataKey="collected"
                  stroke="#10B981"
                  strokeWidth={2}
                  fill="url(#collGrad)"
                  name="Collected"
                  isAnimationActive={!prefersReducedMotion}
                  animationDuration={450}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className={`h-full flex items-center justify-center text-xs ${textMuted}`}>
              {selectedDashboardCurrency
                ? `No billing or collection history in ${selectedDashboardCurrency}.`
                : "No currency data available."}
            </div>
          )}
        </div>
      </div>

      <div className={`min-w-0 p-5 rounded-2xl border ${bgCard}`}>
        <h3 className="text-sm font-bold mb-1">Ageing Bucket Distribution</h3>
        <p className={`text-xs mb-4 ${textMuted}`}>
          Outstanding receivables by overdue days • {selectedDashboardCurrency || "N/A"}
        </p>
        <div className="h-64 w-full min-w-0">
          {ageingChartData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ageingChartData} layout="vertical">
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" width={85} stroke="#808080" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: darkMode ? "#171717" : "#fff",
                    borderColor: "#333",
                    borderRadius: "10px",
                    fontSize: "12px"
                  }}
                  formatter={(value) => formatDashboardCurrency(value, selectedDashboardCurrency)}
                />
                <Bar
                  dataKey="amount"
                  radius={[0, 6, 6, 0]}
                  name="Outstanding"
                  isAnimationActive={!prefersReducedMotion}
                  animationDuration={450}
                >
                  {ageingChartData.map((entry, index) => (
                    <Cell
                      key={entry.name}
                      fill={index === 0 ? "#10B981" : index < 3 ? "#F59E0B" : "#E50914"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className={`h-full flex items-center justify-center text-xs ${textMuted}`}>
              {visibleAgeing
                ? "No outstanding balances in this currency."
                : "Ageing data is unavailable."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
