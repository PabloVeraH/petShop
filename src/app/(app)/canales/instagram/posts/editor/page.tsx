"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

interface Producto {
  id: string;
  nombre: string;
  precio: number;
}

interface ProductTag {
  productoId: string;
  nombre: string;
  precio: number;
}

function EditorContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const postId = searchParams.get("id");

  const [contentType, setContentType] = useState<"post" | "story" | "carousel">("post");
  const [caption, setCaption] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imageUploading, setImageUploading] = useState(false);
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [selectedTags, setSelectedTags] = useState<ProductTag[]>([]);
  const [scheduledFor, setScheduledFor] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/productos")
      .then(r => r.json())
      .then(data => setProductos(Array.isArray(data) ? data : []))
      .catch(console.error);

    if (postId) {
      fetch(`/api/canales/instagram/posts?status=draft`)
        .then(r => r.json())
        .then(posts => {
          const post = posts.find((p: any) => p.id === postId);
          if (post) {
            setContentType(post.content_type);
            setCaption(post.caption || "");
            setImageUrl(post.image_url || "");
            setSelectedTags(post.product_tags || []);
            setScheduledFor(post.scheduled_for ? new Date(post.scheduled_for).toISOString().slice(0, 16) : "");
          }
        })
        .catch(console.error);
    }
  }, [postId]);

  async function handleSave(publish: boolean) {
    setSaving(true);
    setError("");

    const payload = {
      content_type: contentType,
      caption: caption || undefined,
      image_url: imageUrl || undefined,
      media_urls: mediaUrls.length > 0 ? mediaUrls : undefined,
      product_tags: selectedTags.length > 0 ? selectedTags : undefined,
      scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
    };

    const method = postId ? "PATCH" : "POST";
    const url = postId ? `/api/canales/instagram/posts/${postId}` : "/api/canales/instagram/posts";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setSaving(false);
    if (res.ok) {
      router.push("/canales/instagram/posts");
    } else {
      const data = await res.json();
      setError(data.error || "Error guardando");
    }
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setImageUploading(true);
    setError("");
    const form = new FormData();
    form.append("file", file);

    const res = await fetch("/api/canales/instagram/upload", { method: "POST", body: form });
    setImageUploading(false);

    if (res.ok) {
      const { url } = await res.json();
      setImageUrl(url);
    } else {
      const { error: err } = await res.json();
      setError(err ?? "Error subiendo imagen");
    }
  }

  function addTag(producto: Producto) {
    if (!selectedTags.find(t => t.productoId === producto.id)) {
      setSelectedTags([...selectedTags, {
        productoId: producto.id,
        nombre: producto.nombre,
        precio: producto.precio,
      }]);
    }
  }

  return (
    <div className="max-w-4xl">
      <button
        onClick={() => router.push("/canales/instagram/posts")}
        className="text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        ← Volver
      </button>

      <h1 className="text-2xl font-bold text-gray-800 mb-6">
        {postId ? "Editar Publicación" : "Crear Publicación"}
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Content Type Tabs */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <p className="text-sm font-medium text-gray-700 mb-3">Tipo de Contenido</p>
            <div className="flex gap-3">
              {(["post", "story", "carousel"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setContentType(type)}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition ${
                    contentType === type
                      ? "bg-purple-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Image Upload */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">Imagen Principal</label>
            <label className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-md cursor-pointer transition ${imageUploading ? "border-purple-300 bg-purple-50" : "border-gray-300 hover:border-purple-400 hover:bg-purple-50"}`}>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={handleImageUpload}
                disabled={imageUploading}
                className="hidden"
              />
              {imageUploading ? (
                <span className="text-sm text-purple-600">Subiendo...</span>
              ) : (
                <>
                  <span className="text-2xl mb-1">📷</span>
                  <span className="text-sm text-gray-500">Hacé click para seleccionar una imagen</span>
                  <span className="text-xs text-gray-400 mt-1">JPG, PNG, WebP o GIF · máx 10 MB</span>
                </>
              )}
            </label>
            {imageUrl && (
              <div className="mt-3 relative">
                <img src={imageUrl} alt="Preview" className="max-h-64 rounded-md object-cover w-full" />
                <button
                  type="button"
                  onClick={() => setImageUrl("")}
                  className="absolute top-2 right-2 bg-white rounded-full w-6 h-6 text-xs text-gray-600 shadow hover:bg-red-50 hover:text-red-600"
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          {/* Caption */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">Caption</label>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, 2200))}
              placeholder="Escribe el caption..."
              maxLength={2200}
              rows={4}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <p className="text-xs text-gray-500 mt-1">{caption.length}/2200 caracteres</p>
          </div>

          {/* Product Tags */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">Etiquetar Productos</label>
            <div className="mb-3 max-h-40 overflow-y-auto border border-gray-200 rounded-md p-2">
              {productos.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addTag(p)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-purple-50 rounded transition"
                >
                  {p.nombre} - ${p.precio}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedTags.map((tag) => (
                <span
                  key={tag.productoId}
                  className="inline-flex items-center gap-1 bg-purple-100 text-purple-700 px-3 py-1 rounded-full text-sm"
                >
                  {tag.nombre}
                  <button
                    onClick={() => setSelectedTags(selectedTags.filter(t => t.productoId !== tag.productoId))}
                    className="hover:text-purple-900"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Schedule */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">Programar Publicación</label>
            <input
              type="datetime-local"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              autoComplete="off"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              {scheduledFor ? `Publicar: ${new Date(scheduledFor).toLocaleString()}` : "Publicar inmediatamente"}
            </p>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={() => handleSave(false)}
              disabled={saving}
              className="px-4 py-2 bg-gray-600 text-white text-sm font-medium rounded-md hover:bg-gray-700 disabled:opacity-50"
            >
              {saving ? "Guardando..." : "Guardar como Borrador"}
            </button>
            <button
              onClick={() => handleSave(true)}
              disabled={saving || !imageUrl}
              className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-md hover:bg-purple-700 disabled:opacity-50"
            >
              {saving ? "Guardando..." : scheduledFor ? "Programar" : "Publicar Ahora"}
            </button>
          </div>
        </div>

        {/* Preview Panel */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg border border-gray-200 p-6 sticky top-4">
            <p className="text-sm font-medium text-gray-700 mb-4">Vista Previa</p>
            <div className="bg-gray-100 rounded-2xl p-4 aspect-[9/16] flex flex-col overflow-hidden">
              {imageUrl ? (
                <img src={imageUrl} alt="Preview" className="w-full h-48 object-cover rounded-lg mb-3" />
              ) : (
                <div className="w-full h-48 bg-gray-300 rounded-lg mb-3 flex items-center justify-center text-gray-400">
                  Sin imagen
                </div>
              )}
              <p className="text-xs text-gray-600 line-clamp-3">{caption || "Caption aquí..."}</p>
              {selectedTags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {selectedTags.map((tag) => (
                    <span key={tag.productoId} className="text-xs bg-blue-500 text-white px-2 py-1 rounded">
                      {tag.nombre}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function InstagramEditor() {
  return (
    <Suspense fallback={<div className="text-gray-500">Cargando...</div>}>
      <EditorContent />
    </Suspense>
  );
}
