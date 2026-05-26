"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface InstagramPost {
  id: string;
  content_type: string;
  caption?: string;
  image_url?: string;
  scheduled_for: string;
  status: string;
}

export default function ScheduledPosts() {
  const router = useRouter();
  const [posts, setPosts] = useState<InstagramPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPosts();
  }, []);

  async function loadPosts() {
    try {
      const res = await fetch("/api/canales/instagram/posts?status=scheduled");
      const data = await res.json();
      setPosts(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel(postId: string) {
    if (!confirm("¿Eliminar esta publicación programada?")) return;

    const res = await fetch(`/api/canales/instagram/posts/${postId}`, { method: "DELETE" });
    if (res.ok) {
      setPosts(posts.filter(p => p.id !== postId));
    }
  }

  if (loading) return <div className="text-gray-500">Cargando...</div>;

  return (
    <div className="max-w-4xl">
      <button
        onClick={() => router.push("/canales/instagram/posts")}
        className="text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        ← Volver
      </button>

      <h1 className="text-2xl font-bold text-gray-800 mb-2">Publicaciones Programadas</h1>
      <p className="text-gray-500 mb-8">{posts.length} publicaciones en espera</p>

      {posts.length === 0 ? (
        <div className="bg-gray-50 rounded-lg border border-gray-200 p-8 text-center">
          <p className="text-gray-500">No hay publicaciones programadas</p>
          <button
            onClick={() => router.push("/canales/instagram/editor")}
            className="mt-4 text-sm text-purple-600 hover:underline"
          >
            Crear una →
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {posts.map((post) => (
            <div key={post.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              {post.image_url && (
                <img src={post.image_url} alt="Post" className="w-full h-48 object-cover" />
              )}
              <div className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium bg-blue-100 text-blue-700 px-2 py-1 rounded">
                    {post.content_type.toUpperCase()}
                  </span>
                  <span className="text-xs text-gray-500">
                    {new Date(post.scheduled_for).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-gray-700 line-clamp-2 mb-3">
                  {post.caption || "Sin caption"}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => router.push(`/canales/instagram/editor?id=${post.id}`)}
                    className="flex-1 px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded hover:bg-gray-200"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => handleCancel(post.id)}
                    className="flex-1 px-3 py-2 bg-red-50 text-red-600 text-sm font-medium rounded hover:bg-red-100"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
