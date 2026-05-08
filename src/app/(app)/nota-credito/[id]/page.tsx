"use client";

import { use, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type NcData = {
  id: string;
  numero_nc: string;
  monto_total: number;
  fecha_vencimiento: string;
  estado: string;
  created_at: string;
  storeName: string;
};

function NotaCreditoContent({ id }: { id: string }) {
  const searchParams = useSearchParams();
  const autoPrint = searchParams.get("autoPrint") === "1";

  const { data, isLoading, isError } = useQuery<NcData>({
    queryKey: ["nota-credito", id],
    queryFn: () => fetch(`/api/notas-credito/${id}`).then((r) => {
      if (!r.ok) throw new Error("NC no encontrada");
      return r.json();
    }),
  });

  useEffect(() => {
    if (!autoPrint || !data) return;
    const timer = setTimeout(() => {
      window.print();
    }, 500);
    return () => clearTimeout(timer);
  }, [autoPrint, data]);

  if (isLoading) return <p className="p-8 text-center text-gray-400 text-sm">Cargando...</p>;
  if (isError || !data) return <p className="p-8 text-center text-red-500 text-sm">NC no encontrada.</p>;

  const fechaEmision = new Date(data.created_at).toLocaleDateString("es-CL", { dateStyle: "long" });
  const fechaVencimiento = new Date(data.fecha_vencimiento + "T12:00:00").toLocaleDateString("es-CL", { dateStyle: "long" });

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4 print:bg-white print:p-0">
      <div className="bg-white rounded-lg shadow-md p-8 max-w-sm w-full print:shadow-none print:rounded-none print:max-w-none">
        <div className="text-center border-b-2 border-dashed pb-6 mb-6">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{data.storeName}</p>
          <h1 className="text-xl font-bold text-gray-800 mb-1">NOTA DE CRÉDITO</h1>
          <p className="text-xs text-gray-500">Voucher de devolución</p>
        </div>

        <div className="text-center mb-6">
          <p className="text-xs text-gray-500 mb-2">Código</p>
          <p className="font-mono text-lg font-bold tracking-widest bg-gray-50 rounded-lg py-3 px-4 border-2 border-gray-200">
            {data.numero_nc}
          </p>
        </div>

        <div className="space-y-3 mb-6">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">Monto</span>
            <span className="text-2xl font-bold text-green-700">
              ${Math.round(Number(data.monto_total)).toLocaleString("es-CL")}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">Emisión</span>
            <span className="text-sm font-medium">{fechaEmision}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">Vence</span>
            <span className="text-sm font-medium text-amber-700">{fechaVencimiento}</span>
          </div>
        </div>

        <div className="border-t-2 border-dashed pt-4 text-center space-y-1">
          <p className="text-xs text-gray-500">Válido para una compra en {data.storeName}.</p>
          <p className="text-xs text-gray-500">No da vuelto. No acumulable.</p>
          <p className="text-xs text-gray-400 mt-2">Estado: {data.estado === "activa" ? "Vigente" : data.estado}</p>
        </div>

        <div className="mt-6 print:hidden text-center">
          <button
            onClick={() => window.print()}
            className="text-sm text-blue-600 hover:underline"
          >
            Imprimir
          </button>
        </div>
      </div>
    </div>
  );
}

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

export default function NotaCreditoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <QueryClientProvider client={qc}>
      <NotaCreditoContent id={id} />
    </QueryClientProvider>
  );
}
