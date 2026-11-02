// Página que se muestra cuando la dirección no existe (error 404).
import Link from "next/link";

export default function NoEncontrada() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="tarjeta w-full max-w-md p-8 text-center">
        <p className="text-5xl font-extrabold text-marca-700">404</p>
        <h1 className="mt-3 text-lg font-bold text-slate-900">No encontramos esa página</h1>
        <p className="mt-1 text-sm text-slate-500">La dirección no existe o ya fue movida.</p>
        <Link href="/" className="boton boton-primario mt-6 w-full">
          Volver al inicio
        </Link>
      </div>
    </main>
  );
}
