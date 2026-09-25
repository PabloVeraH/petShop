import { redirect } from "next/navigation";

// Las tres páginas de órdenes por canal se unificaron en /pos/pedidos (Fase 3,
// paso 3.8): aceptación automática (D5) y "Marcar lista" para el storeWorker
// (D8), que no tiene acceso a /canales. Se mantiene la ruta para no romper
// enlaces guardados.
export default function OrdenesCanalPage() {
  redirect("/pos/pedidos?canal=ubereats");
}
