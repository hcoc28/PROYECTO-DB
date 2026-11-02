"use client";

// ============================================================
// COMPONENTE — navegación lateral compartida
// En pantallas grandes es un panel fijo a la izquierda; en
// celulares es una barra superior con un menú desplegable.
// Muestra los módulos según el rol, el usuario conectado y "Salir".
// La usan todas las páginas excepto /login. El prop "titulo" se
// usa para el título de la pestaña del navegador.
// El espacio que ocupa el panel lo reserva globals.css
// (regla body:has(.barra-lateral)).
// ============================================================

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ComponentType, type SVGProps } from "react";
import ModalContrasena from "./ModalContrasena";
import { cerrarSesion, obtenerUsuario } from "@/lib/client/apiCliente";
import {
  IconoAjustes,
  IconoBitacora,
  IconoCaja,
  IconoCarrito,
  IconoCerrar,
  IconoClientes,
  IconoFactura,
  IconoGrafica,
  IconoInicio,
  IconoMenu,
  IconoLlave,
  IconoSalir,
  IconoTarjeta,
} from "./iconos";

type IconoTipo = ComponentType<SVGProps<SVGSVGElement>>;

const grupos: { titulo: string; enlaces: { href: string; texto: string; Icono: IconoTipo; roles: string[] }[] }[] = [
  {
    titulo: "Operación",
    enlaces: [
      { href: "/", texto: "Inicio", Icono: IconoInicio, roles: ["ADMIN", "CAJERO", "GERENTE"] },
      { href: "/pos", texto: "Punto de venta", Icono: IconoCarrito, roles: ["ADMIN", "CAJERO"] },
      { href: "/facturas", texto: "Facturas", Icono: IconoFactura, roles: ["ADMIN", "CAJERO", "GERENTE"] },
      { href: "/pagos", texto: "Pagos", Icono: IconoTarjeta, roles: ["ADMIN", "CAJERO", "GERENTE"] },
    ],
  },
  {
    titulo: "Catálogo",
    enlaces: [
      { href: "/inventario", texto: "Inventario", Icono: IconoCaja, roles: ["ADMIN", "CAJERO", "GERENTE"] },
      { href: "/clientes", texto: "Clientes", Icono: IconoClientes, roles: ["ADMIN", "CAJERO", "GERENTE"] },
    ],
  },
  {
    titulo: "Administración",
    enlaces: [
      { href: "/reportes", texto: "Reportes", Icono: IconoGrafica, roles: ["ADMIN", "GERENTE"] },
      { href: "/bitacora", texto: "Bitácora", Icono: IconoBitacora, roles: ["ADMIN"] },
      { href: "/admin", texto: "Configuración", Icono: IconoAjustes, roles: ["ADMIN"] },
    ],
  },
];

export default function NavBar({ titulo }: { titulo: string }) {
  const ruta = usePathname();
  const [usuario, setUsuario] = useState<{ nombreUsuario: string; rol: string } | null>(null);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [cambiandoClave, setCambiandoClave] = useState(false);

  useEffect(() => {
    setUsuario(obtenerUsuario());
  }, []);

  useEffect(() => {
    document.title = `${titulo} · SisEd`;
  }, [titulo]);

  // El menú del celular se cierra al cambiar de página
  useEffect(() => {
    setMenuAbierto(false);
  }, [ruta]);

  const esActivo = (href: string) => (href === "/" ? ruta === "/" : ruta.startsWith(href));
  const rolTexto = usuario?.rol === "ADMIN" ? "Administrador" : usuario?.rol === "GERENTE" ? "Gerente" : "Cajero";

  const navegacion = (
    <nav aria-label="Principal" className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {grupos.map((g) => {
        const visibles = g.enlaces.filter((e) => !usuario || e.roles.includes(usuario.rol));
        if (visibles.length === 0) return null;
        return (
          <div key={g.titulo}>
            <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{g.titulo}</p>
            <ul className="space-y-0.5">
              {visibles.map(({ href, texto, Icono }) => {
                const activo = esActivo(href);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={activo ? "page" : undefined}
                      className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                        activo ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      {activo && <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-marca-400" aria-hidden="true" />}
                      <Icono className={`size-[18px] ${activo ? "text-marca-400" : "text-slate-500 group-hover:text-slate-300"}`} />
                      {texto}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  const tarjetaUsuario = usuario && (
    <div className="border-t border-white/10 p-3">
      <div className="flex items-center gap-3 rounded-xl bg-white/5 p-2.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-marca-500/20 text-sm font-bold text-marca-300">
          {usuario.nombreUsuario.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold text-white">{usuario.nombreUsuario}</p>
          <p className="text-xs text-slate-400">{rolTexto}</p>
        </div>
        <button
          onClick={() => setCambiandoClave(true)}
          className="grid size-9 place-items-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white"
          title="Cambiar mi contraseña"
          aria-label="Cambiar mi contraseña"
        >
          <IconoLlave className="size-[18px]" />
        </button>
        <button
          onClick={() => cerrarSesion()}
          className="grid size-9 place-items-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white"
          title="Cerrar sesión"
          aria-label="Cerrar sesión"
        >
          <IconoSalir className="size-[18px]" />
        </button>
      </div>
    </div>
  );

  const marca = (
    <Link href="/" className="flex items-center gap-3" aria-label="SisEd, ir al inicio">
      <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-marca-400 to-marca-600 text-lg font-extrabold text-white shadow-lg shadow-marca-900/30">
        S
      </span>
      <span className="leading-tight">
        <span className="block text-lg font-bold tracking-tight text-white">SisEd</span>
        <span className="block text-[11px] text-slate-400">Ventas y facturación</span>
      </span>
    </Link>
  );

  return (
    <>
      {/* ---------- Panel lateral (escritorio) ---------- */}
      <aside className="barra-lateral no-imprimir fixed inset-y-0 left-0 z-40 hidden w-64 flex-col bg-gradient-to-b from-slate-900 to-slate-950 lg:flex">
        <div className="px-5 pb-2 pt-6">{marca}</div>
        {navegacion}
        {tarjetaUsuario}
      </aside>

      {/* ---------- Barra superior (celular) ---------- */}
      <header className="no-imprimir sticky top-0 z-40 flex items-center gap-3 bg-slate-900 px-4 py-2.5 lg:hidden">
        <button
          onClick={() => setMenuAbierto(true)}
          className="grid size-10 place-items-center rounded-xl text-slate-200 transition hover:bg-white/10"
          aria-label="Abrir menú"
          aria-expanded={menuAbierto}
        >
          <IconoMenu className="size-5" />
        </button>
        {marca}
        {usuario && (
          <span className="ml-auto grid size-9 place-items-center rounded-full bg-marca-500/20 text-sm font-bold text-marca-300" aria-hidden="true">
            {usuario.nombreUsuario.charAt(0).toUpperCase()}
          </span>
        )}
      </header>

      {menuAbierto && (
        <div className="no-imprimir fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={() => setMenuAbierto(false)} />
          <div className="aparecer absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-gradient-to-b from-slate-900 to-slate-950 shadow-2xl">
            <div className="flex items-center justify-between px-5 pb-2 pt-5">
              {marca}
              <button
                onClick={() => setMenuAbierto(false)}
                className="grid size-9 place-items-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white"
                aria-label="Cerrar menú"
              >
                <IconoCerrar className="size-5" />
              </button>
            </div>
            {navegacion}
            {tarjetaUsuario}
          </div>
        </div>
      )}

      {cambiandoClave && <ModalContrasena onCerrar={() => setCambiandoClave(false)} />}
    </>
  );
}
