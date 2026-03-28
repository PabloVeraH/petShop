type TopProd = { producto_id: string; nombre: string; cantidad: number };

export default function TopProductos({ data }: { data: TopProd[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-gray-400 py-2">Sin ventas hoy</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b">
          <th className="text-left pb-2 font-medium text-gray-600">Producto</th>
          <th className="text-right pb-2 font-medium text-gray-600">Cant.</th>
        </tr>
      </thead>
      <tbody>
        {data.map((item) => (
          <tr key={item.producto_id} className="border-b last:border-0">
            <td className="py-1.5">{item.nombre}</td>
            <td className="py-1.5 text-right font-medium">{item.cantidad}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
