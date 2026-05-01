import { auth } from "@clerk/nextjs/server";

export default async function SistemaSuspendido() {
  const { sessionClaims } = await auth();
  const meta = sessionClaims?.publicMetadata as Record<string, unknown> | undefined;
  const isSystemAdmin = Boolean(meta?.systemAdmin);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full mx-4">
        <div className="bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="mb-6">
            <div className="w-16 h-16 mx-auto bg-red-100 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Sistema Suspendido</h1>
          <p className="text-gray-600 mb-6">
            El período de uso de este sistema ha terminado. Por favor, póngase en contacto con la administración para resolver esta situación.
          </p>
          {isSystemAdmin ? (
            <a
              href="/admin"
              className="inline-block bg-green-600 text-white px-6 py-2 rounded-md hover:bg-green-700 transition-colors"
            >
              Ir al panel de administración
            </a>
          ) : (
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-500">
                Comuníquese con el administrador del sistema para restablecer el acceso.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
