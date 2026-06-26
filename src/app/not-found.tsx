import Link from "next/link";

export default function RootNotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen text-center px-4 bg-gray-50">
      <h1 className="text-6xl font-bold text-[#d4a574] mb-4">404</h1>
      <p className="text-lg text-[#666] mb-8">Página no encontrada</p>
      <Link
        href="/dashboard"
        className="px-6 py-3 bg-[#1a5f3f] text-white font-medium rounded-lg hover:bg-[#0d4730] transition-colors"
      >
        Volver al inicio
      </Link>
    </div>
  );
}
