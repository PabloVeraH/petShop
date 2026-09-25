import Link from "next/link";
import PedidosCanales from "../components/PedidosCanales";

// Vista de pedidos de canales externos para el equipo de la tienda (3.8).
// Vive bajo /pos porque el storeWorker solo tiene acceso a /pos, /customers y
// /dashboard (middleware) y es quien prepara los pedidos (D8).
// searchParams es una Promise en esta versión de Next (docs locales,
// 03-file-conventions/page.md).
export default async function PedidosCanalesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { canal } = await searchParams;
  return (
    <div className="max-w-3xl space-y-4">
      <Link href="/pos" className="text-sm text-gray-500 hover:text-gray-700">← Volver al POS</Link>
      <div>
        <h1 className="text-xl font-bold text-gray-900">Pedidos de canales</h1>
        <p className="text-sm text-gray-500">Se aceptan automáticamente; prepáralos y márcalos como listos para retiro.</p>
      </div>
      <PedidosCanales canal={typeof canal === "string" ? canal : undefined} />
    </div>
  );
}
