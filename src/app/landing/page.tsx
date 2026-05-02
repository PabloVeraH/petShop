export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white font-sans">

      {/* NAV */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/90 backdrop-blur border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🐾</span>
            <span className="text-xl font-bold text-teal-700">AmmaPet</span>
          </div>
          <a
            href="mailto:contacto@ammapet.com"
            className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors"
          >
            Agenda tu demo →
          </a>
        </div>
      </nav>

      {/* HERO */}
      <section className="pt-32 pb-20 px-6 bg-gradient-to-br from-teal-900 via-teal-800 to-teal-700 text-white">
        <div className="max-w-4xl mx-auto text-center">
          <span className="inline-block bg-orange-400/20 text-orange-300 text-sm font-medium px-4 py-1 rounded-full mb-6 border border-orange-400/30">
            Sistema de gestión para petshops
          </span>
          <h1 className="text-4xl md:text-6xl font-extrabold leading-tight mb-6">
            Tu petshop merece más que<br />
            <span className="text-orange-400">una planilla de Excel</span>
          </h1>
          <p className="text-teal-100 text-lg md:text-xl max-w-2xl mx-auto mb-4">
            AmmaPet centraliza tus ventas, inventario, delivery, contabilidad y clientes en una sola plataforma. Sin errores, sin pérdidas, sin caos.
          </p>
          <p className="text-orange-300 font-medium text-base mb-10">
            ⚠️ Cada mes sin sistema = dinero que pierdes sin darte cuenta
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="mailto:contacto@ammapet.com"
              className="bg-orange-500 hover:bg-orange-400 text-white font-bold px-8 py-4 rounded-xl text-lg transition-colors shadow-lg"
            >
              Agenda una demo gratuita →
            </a>
            <a
              href="#funcionalidades"
              className="bg-white/10 hover:bg-white/20 text-white font-semibold px-8 py-4 rounded-xl text-lg transition-colors border border-white/20"
            >
              Ver funcionalidades
            </a>
          </div>
        </div>
      </section>

      {/* PAIN POINTS */}
      <section className="py-20 px-6 bg-slate-50">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">
              ¿Reconoces alguna de estas situaciones?
            </h2>
            <p className="text-slate-500 text-lg">
              Son problemas comunes en petshops que trabajan sin sistema. Y todos tienen solución.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {[
              {
                icon: "🗑️",
                title: "Productos vencidos que tiras a la basura",
                desc: "Alimentos y medicamentos que expiran sin que te enteres. Pérdida directa, sin posibilidad de recuperación.",
              },
              {
                icon: "📱",
                title: "Pedidos de delivery que pierdes",
                desc: "Tus competidores ya cobran por Rappi y PedidosYa. Cada pedido que no tomas es una venta que se va a otro.",
              },
              {
                icon: "📊",
                title: "Horas perdidas en contabilidad manual",
                desc: "Planillas de Excel, errores de carga, cierres de mes eternos. Tiempo que podrías dedicar a tu negocio.",
              },
              {
                icon: "🙈",
                title: "Cero información sobre tus clientes",
                desc: "No sabes quién compra más, qué productos se van más rápido, ni cómo fidelizar a los que valen la pena.",
              },
              {
                icon: "📦",
                title: "Descontrol con tus proveedores",
                desc: "Órdenes de compra en papel, facturas perdidas, deudas que no recuerdas. El caos que te frena a crecer.",
              },
              {
                icon: "👁️",
                title: "No sabes qué hacen tus empleados",
                desc: "Sin control de accesos, cualquiera puede ver o modificar lo que quiera. Un riesgo que no puedes ignorar."
              },
            ].map((item) => (
              <div key={item.title} className="bg-white rounded-2xl p-6 border border-slate-200 flex gap-4 shadow-sm">
                <span className="text-3xl flex-shrink-0">{item.icon}</span>
                <div>
                  <h3 className="font-bold text-slate-900 mb-1">{item.title}</h3>
                  <p className="text-slate-500 text-sm leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* BRIDGE */}
      <section className="py-16 px-6 bg-teal-700 text-white text-center">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            AmmaPet resuelve todo esto desde el primer día
          </h2>
          <p className="text-teal-100 text-lg">
            Una plataforma diseñada exclusivamente para petshops en Chile. Con soporte en español incluido.
          </p>
        </div>
      </section>

      {/* FEATURES */}
      <section id="funcionalidades" className="py-20 px-6 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">
              Todo lo que tu petshop necesita
            </h2>
            <p className="text-slate-500 text-lg">
              8 módulos integrados. Un solo sistema.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: "🛒",
                color: "bg-teal-50 text-teal-700",
                title: "Punto de Venta",
                desc: "Cierra ventas en segundos. Multi-método de pago. Sin colas, sin errores.",
              },
              {
                icon: "📦",
                color: "bg-orange-50 text-orange-700",
                title: "Inventario Inteligente",
                desc: "Stock en tiempo real. Alertas de vencimiento automáticas. Nunca más pierdas un producto.",
              },
              {
                icon: "🚀",
                color: "bg-blue-50 text-blue-700",
                title: "Delivery Multi-Canal",
                desc: "Rappi, PedidosYa y UberEats integrados. Todos tus pedidos en un solo lugar.",
              },
              {
                icon: "📊",
                color: "bg-purple-50 text-purple-700",
                title: "Contabilidad Automática",
                desc: "Cada venta genera su asiento contable sola. Fin de las planillas manuales.",
              },
              {
                icon: "👥",
                color: "bg-green-50 text-green-700",
                title: "Clientes & Fidelización",
                desc: "Historial completo de compras. Saldos a favor. Conoce a tus mejores clientes.",
              },
              {
                icon: "🔄",
                color: "bg-yellow-50 text-yellow-700",
                title: "Devoluciones Simples",
                desc: "Notas de crédito internas y saldos a favor en segundos. Sin papelerío innecesario.",
              },
              {
                icon: "🏭",
                color: "bg-rose-50 text-rose-700",
                title: "Supply Chain",
                desc: "Órdenes de compra y cuentas por pagar. Control total de tus proveedores.",
              },
              {
                icon: "🔐",
                color: "bg-slate-100 text-slate-700",
                title: "Roles & Seguridad",
                desc: "Define qué puede ver y hacer cada empleado. Auditoría completa de cada cambio.",
              },
            ].map((f) => (
              <div key={f.title} className="rounded-2xl border border-slate-100 p-6 hover:shadow-md transition-shadow">
                <div className={`w-12 h-12 rounded-xl ${f.color} flex items-center justify-center text-2xl mb-4`}>
                  {f.icon}
                </div>
                <h3 className="font-bold text-slate-900 mb-2">{f.title}</h3>
                <p className="text-slate-500 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ROI */}
      <section className="py-20 px-6 bg-slate-900 text-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Resultados concretos desde el primer mes
            </h2>
            <p className="text-slate-400 text-lg">
              Números conservadores basados en la experiencia de petshops que ya usan el sistema.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { stat: "3 hs", label: "diarias ahorradas", sub: "en tareas administrativas" },
              { stat: "$0", label: "en pérdidas", sub: "por productos vencidos" },
              { stat: "+30%", label: "más ventas", sub: "integrando delivery" },
              { stat: "100%", label: "trazabilidad", sub: "de cada movimiento" },
            ].map((r) => (
              <div key={r.label} className="text-center bg-slate-800 rounded-2xl p-8">
                <div className="text-4xl font-extrabold text-orange-400 mb-2">{r.stat}</div>
                <div className="font-bold text-white text-lg">{r.label}</div>
                <div className="text-slate-400 text-sm mt-1">{r.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* WHY AMMAPET */}
      <section className="py-20 px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">
              ¿Por qué AmmaPet?
            </h2>
          </div>
          <div className="grid md:grid-cols-2 gap-8">
            {[
              {
                icon: "🌎",
                title: "Hecho para usted",
                desc: "Diseñado para petshops de Chile. Con los canales de delivery que usas, en tu idioma y con tu moneda.",
              },
              {
                icon: "📱",
                title: "Desde cualquier dispositivo",
                desc: "Accede desde tu computadora, tablet o celular. Tu negocio en el bolsillo, sin instalaciones.",
              },
              {
                icon: "☁️",
                title: "Datos siempre seguros",
                desc: "Tu información guardada en la nube con backup automático. Sin riesgo de perder datos por fallas de hardware.",
              },
              {
                icon: "🤝",
                title: "Soporte en español",
                desc: "Acompañamiento real desde la implementación. Hablamos tu idioma y entendemos tu negocio.",
              },
            ].map((w) => (
              <div key={w.title} className="flex gap-5 p-6 rounded-2xl bg-slate-50 border border-slate-100">
                <span className="text-4xl">{w.icon}</span>
                <div>
                  <h3 className="font-bold text-slate-900 text-lg mb-1">{w.title}</h3>
                  <p className="text-slate-500 leading-relaxed">{w.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* RISK REMOVAL */}
      <section className="py-16 px-6 bg-teal-50 border-y border-teal-100">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-slate-900 mb-4">
            Empezá sin riesgo
          </h2>
          <p className="text-slate-600 mb-10 text-lg">
            No necesitás comprometerte con nada para probar AmmaPet.
          </p>
          <div className="grid sm:grid-cols-4 gap-6">
            {[
              { icon: "🎯", label: "Demo en 30 min" },
              { icon: "📋", label: "Sin contratos de largo plazo" },
              { icon: "🛠️", label: "Implementación asistida incluida" },
              { icon: "💬", label: "Soporte técnico en español" },
            ].map((r) => (
              <div key={r.label} className="bg-white rounded-xl p-5 shadow-sm border border-teal-100">
                <div className="text-3xl mb-3">{r.icon}</div>
                <div className="text-slate-700 font-medium text-sm">{r.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="py-24 px-6 bg-gradient-to-br from-teal-900 to-teal-700 text-white text-center">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-4xl md:text-5xl font-extrabold mb-6">
            Transforma tu petshop hoy
          </h2>
          <p className="text-teal-100 text-xl mb-10">
            Cada día que pasa sin sistema es dinero que pierdes.
            Agenda una demo gratuita y véelo en acción.
          </p>
          <a
            href="mailto:contacto@ammapet.com"
            className="inline-block bg-orange-500 hover:bg-orange-400 text-white font-bold px-10 py-5 rounded-xl text-xl transition-colors shadow-xl"
          >
            Agenda tu demo gratuita →
          </a>
          <p className="text-teal-300 text-sm mt-6">
            Sin compromisos · Respuesta en menos de 24 horas
          </p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="py-8 px-6 bg-slate-950 text-slate-500 text-center text-sm">
        <div className="flex items-center justify-center gap-2 mb-2">
          <span className="text-lg">🐾</span>
          <span className="font-semibold text-white">AmmaPet</span>
        </div>
        <p>Sistema de gestión integral para petshops</p>
      </footer>
    </div>
  );
}
