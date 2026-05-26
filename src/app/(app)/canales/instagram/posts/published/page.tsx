"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface InstagramPost {
  id: string;
  content_type: string;
  caption?: string;
  image_url?: string;
  published_at?: string;
  external_post_id?: string;
}

export default function PublishedPosts() {
  const router = useRouter();
  const [posts, setPosts] = useState<InstagramPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPosts();
  }, []);

  async function loadPosts() {
    try {
      const res = await fetch("/api/canales/instagram/posts?status=published");
      const data = await res.json();
      setPosts(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function timeAgo(date: string): string {
    const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return "hace unos segundos";
    if (seconds < 3600) return `hace ${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `hace ${Math.floor(seconds / 3600)}h`;
    return `hace ${Math.floor(seconds / 86400)}d`;
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

      <h1 className="text-2xl font-bold text-gray-800 mb-2">Historial de Publicaciones</h1>
      <p className="text-gray-500 mb-8">{posts.length} publicaciones</p>

      {posts.length === 0 ? (
        <div className="bg-gray-50 rounded-lg border border-gray-200 p-8 text-center">
          <p className="text-gray-500">No hay publicaciones aún</p>
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
                  <span className="text-xs font-medium bg-green-100 text-green-700 px-2 py-1 rounded">
                    {post.content_type.toUpperCase()}
                  </span>
                  <span className="text-xs text-gray-500">
                    {post.published_at ? timeAgo(post.published_at) : "Publicado"}
                  </span>
                </div>
                <p className="text-sm text-gray-700 line-clamp-2 mb-3">
                  {post.caption || "Sin caption"}
                </p>
                {post.external_post_id && (
                  <button
                    onClick={() => window.open(`https://instagram.com/p/${post.external_post_id}`, "_blank")}
                    className="w-full px-3 py-2 bg-purple-50 text-purple-600 text-sm font-medium rounded hover:bg-purple-100"
                  >
                    Ver en Instagram ↗
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
