export default function StatCard({ title, value, icon, color }) {
  return (
    <div className="bg-secondary rounded-lg border border-gray-700 p-6 hover:border-gray-600 transition">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-gray-400 text-sm mb-1">{title}</p>
          <p className="text-3xl font-bold text-white">{value}</p>
        </div>
        <div className={`p-3 rounded-lg ${color}`}>
          {icon}
        </div>
      </div>
    </div>
  )
}
