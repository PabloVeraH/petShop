import CatalogoCanal from "../../components/CatalogoCanal";

// Catálogo del canal (Fase 4, paso 4.4): componente común a los canales
// externos (D9). Acceso solo storeAdmin/systemAdmin, validado en la API.
export default function RappiCatalogoPage() {
  return <CatalogoCanal canal={{ id: "rappi", nombre: "Rappi", icono: "🛵", color: "bg-red-500" }} />;
}
