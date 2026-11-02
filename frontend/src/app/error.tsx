"use client";

// Pantalla de respaldo si una página falla de forma inesperada:
// en vez de una pantalla en blanco, se ofrece reintentar o volver al inicio.
export default function ErrorGeneral({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="tarjeta w-full max-w-md p-8 text-center" role="alert">
        <h1 className="text-lg font-bold text-slate-900">Algo salió mal</h1>
        <p className="mt-1 text-sm text-slate-500">Ocurrió un error inesperado. Tus datos no se perdieron.</p>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button type="button" onClick={() => retry()} className="boton boton-primario">
            Reintentar
          </button>
          {/* enlace normal (no <Link>) para reiniciar por completo la aplicación */}
          <a href="/" className="boton boton-secundario">
            Ir al inicio
          </a>
        </div>
      </div>
    </main>
  );
}
