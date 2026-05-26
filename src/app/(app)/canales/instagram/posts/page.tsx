"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface InstagramConfig {
  canal_id: string;
  activo: boolean;
}

interface InstagramPost {
  id: string;
  status: string;
}

export default function InstagramDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [stats, setStats] = useState({ scheduled: 0, published: 0 });

  useEffect(() => {
    async function load() {
      try {
        const configRes = await fetch("/api/canales/config");
        const configs: InstagramConfig[] = await configRes.json();
        const igConfig = configs.find(c => c.canal_id === "instagram");
        setConfigured(!!igConfig?.activo);

        if (igConfig?.activo) {
          const postsRes = await fetch("/api/canales/instagram/posts");
          const posts: InstagramPost[] = await postsRes.json();
          setStats({
            scheduled: posts.filter(p => p.status === "scheduled").length,
            published: posts.filter(p => p.status === "published").length,
          });
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <div className="text-gray-500">Cargando...</div>;

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-800 mb-2">Instagram</h1>
      <p className="text-gray-500 mb-8">Administra tus publicaciones en Instagram</p>

      {!configured && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 mb-8">
          <p className="text-yellow-800 font-medium mb-3">Configura tu cuenta de Instagram</p>
          <p className="text-yellow-700 text-sm mb-4">
            Necesitas conectar tu cuenta profesional para empezar a publicar
          </p>
          <button
            onClick={() => router.push("/canales/instagram")}
            className="px-4 py-2 bg-yellow-600 text-white text-sm font-medium rounded-md hover:bg-yellow-700"
          >
            Configurar ahora
          </button>
        </div>
      )}

      {configured && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <p className="text-gray-500 text-sm mb-1">Publicaciones Programadas</p>
              <p className="text-3xl font-bold text-purple-600">{stats.scheduled}</p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <p className="text-gray-500 text-sm mb-1">Publicadas</p>
              <p className="text-3xl font-bold text-green-600">{stats.published}</p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <p className="text-gray-500 text-sm mb-1">Estado</p>
              <p className="text-lg font-semibold text-green-700">Conectado</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              onClick={() => router.push("/canales/instagram/posts/editor")}
              className="bg-purple-50 border border-purple-200 rounded-lg p-6 text-left hover:bg-purple-100 transition"
            >
              <p className="text-2xl mb-2">➕</p>
              <h3 className="font-semibold text-gray-800">Crear Publicación</h3>
              <p className="text-sm text-gray-500 mt-1">Nuevo post, historia o carrusel</p>
            </button>

            <button
              onClick={() => router.push("/canales/instagram/posts/scheduled")}
              className="bg-blue-50 border border-blue-200 rounded-lg p-6 text-left hover:bg-blue-100 transition"
            >
              <p className="text-2xl mb-2">📅</p>
              <h3 className="font-semibold text-gray-800">Programados</h3>
              <p className="text-sm text-gray-500 mt-1">{stats.scheduled} posts en cola</p>
            </button>

            <button
              onClick={() => router.push("/canales/instagram/posts/published")}
              className="bg-green-50 border border-green-200 rounded-lg p-6 text-left hover:bg-green-100 transition"
            >
              <p className="text-2xl mb-2">✅</p>
              <h3 className="font-semibold text-gray-800">Historial</h3>
              <p className="text-sm text-gray-500 mt-1">{stats.published} publicadas</p>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
