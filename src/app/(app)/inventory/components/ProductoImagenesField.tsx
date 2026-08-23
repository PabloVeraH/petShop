"use client";

import { useState, useRef } from "react";

type ImageSlotProps = {
  slot: string;
  label: string;
  url: string | null;
  productoId: string;
  onUpload: (url: string) => void;
  onRemove: () => void;
};

function ImageSlot({ slot, label, url, productoId, onUpload, onRemove }: ImageSlotProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("productoId", productoId);

      const res = await fetch("/api/productos/imagenes", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Error al subir imagen");
      }

      onUpload(data.url);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      setError(message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemove() {
    if (url) {
      try {
        await fetch("/api/productos/imagenes", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
      } catch {
        // Best-effort: si falla el borrado en R2, igual limpiamos el campo
      }
    }
    onRemove();
  }

  return (
    <div className="border border-gray-200 rounded-md p-3">
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      {url ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={label}
            className="w-20 h-20 object-cover rounded-md border border-gray-200"
          />
          <button
            type="button"
            onClick={handleRemove}
            className="text-xs text-red-500 hover:text-red-700 underline"
          >
            Eliminar
          </button>
        </div>
      ) : (
        <div>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileChange}
            className="hidden"
            id={`img-upload-${slot}`}
          />
          <label
            htmlFor={`img-upload-${slot}`}
            className={`inline-block cursor-pointer text-xs px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50 ${
              uploading ? "opacity-50 pointer-events-none" : ""
            }`}
          >
            {uploading ? "Subiendo..." : "Seleccionar imagen"}
          </label>
          {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
        </div>
      )}
    </div>
  );
}

type ProductoImagenesFieldProps = {
  imagenUrl: string | null;
  imagenUrl2: string | null;
  productoId: string;
  onChange: (field: "imagen_url" | "imagen_url_2", value: string | null) => void;
};

export function ProductoImagenesField({
  imagenUrl,
  imagenUrl2,
  productoId,
  onChange,
}: ProductoImagenesFieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">Fotos del producto</label>
      <div className="grid grid-cols-2 gap-3">
        <ImageSlot
          slot="principal"
          label="Foto principal"
          url={imagenUrl}
          productoId={productoId}
          onUpload={(url) => onChange("imagen_url", url)}
          onRemove={() => onChange("imagen_url", null)}
        />
        <ImageSlot
          slot="secundaria"
          label="Foto secundaria"
          url={imagenUrl2}
          productoId={productoId}
          onUpload={(url) => onChange("imagen_url_2", url)}
          onRemove={() => onChange("imagen_url_2", null)}
        />
      </div>
    </div>
  );
}
