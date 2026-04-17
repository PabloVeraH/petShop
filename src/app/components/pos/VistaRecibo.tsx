"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

interface VistaReciboProps {
  ventaId: string;
  onClose?: () => void;
}

export function VistaRecibo({ ventaId, onClose }: VistaReciboProps) {
  const [isDownloading, setIsDownloading] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["recibo", ventaId],
    queryFn: async () => {
      const res = await fetch(`/api/recibos/${ventaId}`);
      if (!res.ok) throw new Error("Error al obtener recibo");
      return res.json();
    },
  });

  const handlePrint = () => {
    if (!data?.html) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    printWindow.document.write(data.html);
    printWindow.document.close();

    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 250);
  };

  const handleDownloadPDF = async () => {
    if (!data?.html) return;

    setIsDownloading(true);
    try {
      // Crear blob del HTML
      const blob = new Blob([data.html], { type: "text/html" });
      const url = URL.createObjectURL(blob);

      // Crear iframe temporal para renderizar
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = url;
      document.body.appendChild(iframe);

      iframe.onload = () => {
        // Aquí idealmente usarías html2canvas + jspdf
        // Por ahora, descargamos el HTML
        const a = document.createElement("a");
        a.href = url;
        a.download = `recibo-${data.numeroComprobante}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        document.body.removeChild(iframe);
        URL.revokeObjectURL(url);
        setIsDownloading(false);
      };
    } catch (err) {
      console.error("Error descargando recibo:", err);
      setIsDownloading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-gray-600">Cargando recibo...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-red-600 mb-4">Error al cargar el recibo</p>
          {onClose && (
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
            >
              Cerrar
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-md mx-auto">
        {/* Toolbar */}
        <div className="bg-white shadow rounded-t-lg p-4 flex gap-3 flex-wrap">
          <button
            onClick={handlePrint}
            className="flex-1 min-w-[140px] px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium"
          >
            🖨️ Imprimir
          </button>
          <button
            onClick={handleDownloadPDF}
            disabled={isDownloading}
            className="flex-1 min-w-[140px] px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 text-sm font-medium"
          >
            {isDownloading ? "Descargando..." : "⬇️ Descargar"}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="flex-1 min-w-[140px] px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 text-sm font-medium"
            >
              ✕ Cerrar
            </button>
          )}
        </div>

        {/* Recibo Preview */}
        <div className="bg-white shadow-lg rounded-b-lg p-4 overflow-auto max-h-[calc(100vh-200px)]">
          <iframe
            srcDoc={data?.html}
            className="w-full h-auto border-0"
            title="Vista previa recibo"
            style={{
              minHeight: "800px",
              backgroundColor: "white",
            }}
          />
        </div>

        {/* Info */}
        <div className="mt-4 text-center text-sm text-gray-600">
          <p>Recibo #{data?.numeroComprobante}</p>
          <p>Total: ${Number(data?.total).toLocaleString("es-CL")}</p>
        </div>
      </div>
    </div>
  );
}
