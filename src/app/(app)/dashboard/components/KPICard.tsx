import { Card, CardContent } from "@/components/ui/card";

export default function KPICard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-2xl font-bold mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}
