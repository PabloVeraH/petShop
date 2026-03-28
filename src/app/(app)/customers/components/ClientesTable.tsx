import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRUT } from "@/lib/validation";
import type { Cliente } from "@/types";

export default function ClientesTable({
  data,
  selectedId,
  onSelect,
}: {
  data: Cliente[];
  selectedId?: string;
  onSelect: (c: Cliente) => void;
}) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-gray-400 p-4 text-center">Sin clientes</p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nombre</TableHead>
          <TableHead>RUT</TableHead>
          <TableHead>Contacto</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((c) => (
          <TableRow
            key={c.id}
            className={`cursor-pointer ${
              selectedId === c.id ? "bg-green-50" : "hover:bg-gray-50"
            }`}
            onClick={() => onSelect(c)}
          >
            <TableCell className="font-medium">{c.nombre}</TableCell>
            <TableCell className="text-gray-500">{formatRUT(c.rut)}</TableCell>
            <TableCell className="text-gray-500">
              {c.email ?? c.telefono ?? "-"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
