"use client";

// ============================================================
// PÁGINA DE CONFIGURACIÓN — ruta: /admin   (solo ADMIN)
// Tres pestañas, una por tabla de la base de datos:
//  · Negocio   (negocio)  datos fiscales y certificador.
//  · Usuarios  (usuario / rol)  crear, cambiar rol, activar o
//    desactivar y restablecer contraseñas.
//  · Series    (serie)  series de facturación y su correlativo.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, haySesion, obtenerUsuario } from "@/lib/client/apiCliente";
import { notificar } from "@/lib/client/avisos";
import NavBar from "../_components/NavBar";
import {
  IconoAlerta,
  IconoCerrar,
  IconoEdificio,
  IconoFactura,
  IconoLlave,
  IconoMas,
  IconoUsuario,
} from "../_components/iconos";

interface Negocio {
  nit: string;
  razon_social: string;
  nombre_comercial: string;
  direccion: string;
  municipio: string;
  departamento: string;
  regimen: string;
  certificador: string | null;
  ambiente: string;
  usuario_api: string | null;
  llaveApiConfigurada: boolean;
  llaveFirmaConfigurada: boolean;
}
interface Usuario {
  id_usuario: number;
  nombre_usuario: string;
  activo: boolean;
  rol: { nombre_rol: string };
}
interface Serie {
  id_serie: number;
  tipo_documento: string;
  serie: string;
  correlativo: string;
  activa: boolean;
}

const NEGOCIO_VACIO: Negocio = {
  nit: "",
  razon_social: "",
  nombre_comercial: "",
  direccion: "",
  municipio: "",
  departamento: "",
  regimen: "GEN",
  certificador: "INFILE",
  ambiente: "CERTIFICACION",
  usuario_api: "",
  llaveApiConfigurada: false,
  llaveFirmaConfigurada: false,
};

type Pestana = "negocio" | "usuarios" | "series";

export default function PaginaAdmin() {
  const router = useRouter();
  const [listo, setListo] = useState(false);
  const [yo, setYo] = useState<string>("");
  const [pestana, setPestana] = useState<Pestana>("negocio");
  const [negocio, setNegocio] = useState<Negocio>(NEGOCIO_VACIO);
  const [llaveApi, setLlaveApi] = useState("");
  const [llaveFirma, setLlaveFirma] = useState("");
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [series, setSeries] = useState<Serie[]>([]);
  const [nuevoUsuario, setNuevoUsuario] = useState({ nombre_usuario: "", password: "", nombre_rol: "CAJERO" });
  const [nuevaSerie, setNuevaSerie] = useState({ tipo_documento: "FACT", serie: "" });
  const [mostrarFormUsuario, setMostrarFormUsuario] = useState(false);
  const [mostrarFormSerie, setMostrarFormSerie] = useState(false);
  const [clave, setClave] = useState<{ usuario: Usuario; valor: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!haySesion()) {
      router.replace("/login");
      return;
    }
    const u = obtenerUsuario();
    if (u?.rol !== "ADMIN") {
      router.replace("/");
      return;
    }
    setYo(u.nombreUsuario);
    setListo(true);
  }, [router]);

  const cargarTodo = useCallback(async () => {
    const [rn, ru, rs] = await Promise.all([
      apiFetch<{ negocio: Negocio | null }>("/api/v1/negocio"),
      apiFetch<{ usuarios: Usuario[] }>("/api/v1/usuarios"),
      apiFetch<{ series: Serie[] }>("/api/v1/series?todas=1"),
    ]);
    if (rn.datos?.negocio) setNegocio(rn.datos.negocio);
    if (ru.datos) setUsuarios(ru.datos.usuarios);
    if (rs.datos) setSeries(rs.datos.series);
  }, []);

  useEffect(() => {
    if (listo) cargarTodo();
  }, [listo, cargarTodo]);

  function aviso(texto: string) {
    setError(null);
    notificar.ok(texto);
  }

  async function guardarNegocio(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const r = await apiFetch("/api/v1/negocio", {
      method: "PUT",
      // Se arma el cuerpo campo por campo: la base devuelve null en los
      // datos del certificador que aún no se han llenado, y la API no
      // acepta null (solo texto o ausente), así que no se podía re-guardar.
      body: JSON.stringify({
        nit: negocio.nit,
        razon_social: negocio.razon_social,
        nombre_comercial: negocio.nombre_comercial,
        direccion: negocio.direccion,
        municipio: negocio.municipio,
        departamento: negocio.departamento,
        regimen: negocio.regimen,
        ambiente: negocio.ambiente,
        certificador: negocio.certificador || undefined,
        usuario_api: negocio.usuario_api || undefined,
        llave_api: llaveApi || undefined,
        llave_firma: llaveFirma || undefined,
      }),
    });
    if (!r.ok) {
      const detalle = r.error?.detalles ? ` (${Object.keys(r.error.detalles).join(", ")})` : "";
      setError((r.error?.mensaje ?? "No se pudo guardar") + detalle);
      return;
    }
    setLlaveApi("");
    setLlaveFirma("");
    aviso("Datos del negocio guardados");
    cargarTodo();
  }

  async function crearUsuario(e: React.FormEvent) {
    e.preventDefault();
    const r = await apiFetch("/api/v1/usuarios", { method: "POST", body: JSON.stringify(nuevoUsuario) });
    if (!r.ok) {
      setError(r.error?.mensaje ?? "No se pudo crear el usuario");
      return;
    }
    setNuevoUsuario({ nombre_usuario: "", password: "", nombre_rol: "CAJERO" });
    setMostrarFormUsuario(false);
    aviso("Usuario creado");
    cargarTodo();
  }

  async function actualizarUsuario(u: Usuario, cambios: { activo?: boolean; nombre_rol?: string; password?: string }, texto: string) {
    const r = await apiFetch(`/api/v1/usuarios/${u.id_usuario}`, { method: "PUT", body: JSON.stringify(cambios) });
    if (!r.ok) {
      setError(r.error?.mensaje ?? "No se pudo actualizar el usuario");
      return false;
    }
    aviso(texto);
    cargarTodo();
    return true;
  }

  async function restablecerClave(e: React.FormEvent) {
    e.preventDefault();
    if (!clave) return;
    const ok = await actualizarUsuario(clave.usuario, { password: clave.valor }, `Contraseña de ${clave.usuario.nombre_usuario} restablecida`);
    if (ok) setClave(null);
  }

  async function crearSerie(e: React.FormEvent) {
    e.preventDefault();
    const r = await apiFetch("/api/v1/series", { method: "POST", body: JSON.stringify(nuevaSerie) });
    if (!r.ok) {
      setError(r.error?.mensaje ?? "No se pudo crear la serie");
      return;
    }
    setNuevaSerie({ tipo_documento: "FACT", serie: "" });
    setMostrarFormSerie(false);
    aviso("Serie agregada");
    cargarTodo();
  }

  async function cambiarSerie(s: Serie, activa: boolean) {
    const r = await apiFetch(`/api/v1/series/${s.id_serie}`, { method: "PUT", body: JSON.stringify({ activa }) });
    if (!r.ok) {
      setError(r.error?.mensaje ?? "No se pudo actualizar la serie");
      return;
    }
    aviso(`Serie ${s.tipo_documento}-${s.serie} ${activa ? "activada" : "desactivada"}`);
    cargarTodo();
  }

  if (!listo) return null;

  const pestanas: { id: Pestana; texto: string; Icono: typeof IconoEdificio; cuenta?: number }[] = [
    { id: "negocio", texto: "Negocio", Icono: IconoEdificio },
    { id: "usuarios", texto: "Usuarios", Icono: IconoUsuario, cuenta: usuarios.length },
    { id: "series", texto: "Series", Icono: IconoFactura, cuenta: series.length },
  ];

  return (
    <>
      <NavBar titulo="Configuración" />
      <main className="pagina max-w-5xl">
        <div className="encabezado-pagina">
          <div>
            <h1 className="titulo-pagina">Configuración</h1>
            <p className="subtitulo-pagina">Datos del negocio, usuarios del sistema y series de facturación</p>
          </div>
        </div>

        <div className="mb-5 flex gap-1 overflow-x-auto rounded-2xl border border-slate-200/80 bg-white p-1.5 shadow-sm" role="tablist">
          {pestanas.map(({ id, texto, Icono, cuenta }) => (
            <button
              key={id}
              role="tab"
              aria-selected={pestana === id}
              onClick={() => setPestana(id)}
              className={`flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                pestana === id ? "bg-marca-700 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Icono className="size-4" />
              {texto}
              {cuenta !== undefined && (
                <span className={`rounded-full px-1.5 text-xs ${pestana === id ? "bg-white/20" : "bg-slate-100 text-slate-500"}`}>{cuenta}</span>
              )}
            </button>
          ))}
        </div>

        {error && (
          <div className="alerta alerta-error mb-4" role="alert">
            <IconoAlerta className="mt-0.5 size-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} aria-label="Cerrar aviso">
              <IconoCerrar className="size-4" />
            </button>
          </div>
        )}

        {/* =================== NEGOCIO =================== */}
        {pestana === "negocio" && (
          <section className="tarjeta aparecer">
            <div className="seccion-titulo">
              <span className="icono-caja bg-marca-50 text-marca-700">
                <IconoEdificio className="size-5" />
              </span>
              <div>
                <h2 className="font-semibold text-slate-900">Datos del negocio</h2>
                <p className="text-sm text-slate-500">Aparecen en cada factura que emitas</p>
              </div>
            </div>
            <form onSubmit={guardarNegocio} className="p-5 sm:p-6">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div>
                  <label className="etiqueta" htmlFor="n-nit">NIT</label>
                  <input id="n-nit" required value={negocio.nit} onChange={(e) => setNegocio({ ...negocio, nit: e.target.value })} className="campo" />
                </div>
                <div>
                  <label className="etiqueta" htmlFor="n-regimen">Régimen</label>
                  <select id="n-regimen" value={negocio.regimen} onChange={(e) => setNegocio({ ...negocio, regimen: e.target.value })} className="campo">
                    <option value="GEN">General (IVA 12%)</option>
                    <option value="PEQ">Pequeño contribuyente (5%)</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="etiqueta" htmlFor="n-razon">Razón social</label>
                  <input id="n-razon" required value={negocio.razon_social} onChange={(e) => setNegocio({ ...negocio, razon_social: e.target.value })} className="campo" />
                </div>
                <div className="sm:col-span-2">
                  <label className="etiqueta" htmlFor="n-comercial">Nombre comercial</label>
                  <input id="n-comercial" required value={negocio.nombre_comercial} onChange={(e) => setNegocio({ ...negocio, nombre_comercial: e.target.value })} className="campo" />
                </div>
                <div className="sm:col-span-2">
                  <label className="etiqueta" htmlFor="n-direccion">Dirección</label>
                  <input id="n-direccion" required value={negocio.direccion} onChange={(e) => setNegocio({ ...negocio, direccion: e.target.value })} className="campo" />
                </div>
                <div>
                  <label className="etiqueta" htmlFor="n-municipio">Municipio</label>
                  <input id="n-municipio" required value={negocio.municipio} onChange={(e) => setNegocio({ ...negocio, municipio: e.target.value })} className="campo" />
                </div>
                <div>
                  <label className="etiqueta" htmlFor="n-depto">Departamento</label>
                  <input id="n-depto" required value={negocio.departamento} onChange={(e) => setNegocio({ ...negocio, departamento: e.target.value })} className="campo" />
                </div>
              </div>

              <div className="mt-8 border-t border-slate-100 pt-6">
                <h3 className="font-semibold text-slate-900">Certificador de facturas electrónicas</h3>
                <p className="mt-1 text-sm text-slate-500">Opcional: puedes guardar los datos del negocio sin llenar esta parte.</p>
                <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <div>
                    <label className="etiqueta" htmlFor="c-certificador">Certificador</label>
                    <select id="c-certificador" value={negocio.certificador ?? "INFILE"} onChange={(e) => setNegocio({ ...negocio, certificador: e.target.value })} className="campo">
                      <option value="INFILE">Infile</option>
                      <option value="G4S">G4S</option>
                      <option value="MEGAPRINT">Megaprint</option>
                    </select>
                  </div>
                  <div>
                    <label className="etiqueta" htmlFor="c-ambiente">Ambiente</label>
                    <select id="c-ambiente" value={negocio.ambiente} onChange={(e) => setNegocio({ ...negocio, ambiente: e.target.value })} className="campo">
                      <option value="CERTIFICACION">Certificación (pruebas)</option>
                      <option value="PRODUCCION">Producción</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="etiqueta" htmlFor="c-usuario">Usuario API</label>
                    <input id="c-usuario" value={negocio.usuario_api ?? ""} onChange={(e) => setNegocio({ ...negocio, usuario_api: e.target.value })} className="campo" />
                  </div>
                  <div>
                    <label className="etiqueta" htmlFor="c-llave">
                      Llave API {negocio.llaveApiConfigurada && <span className="chip chip-ok ml-1.5">Configurada</span>}
                    </label>
                    <input id="c-llave" type="password" placeholder="Dejar en blanco para no cambiar" value={llaveApi} onChange={(e) => setLlaveApi(e.target.value)} className="campo" autoComplete="new-password" />
                  </div>
                  <div>
                    <label className="etiqueta" htmlFor="c-firma">
                      Llave de firma {negocio.llaveFirmaConfigurada && <span className="chip chip-ok ml-1.5">Configurada</span>}
                    </label>
                    <input id="c-firma" type="password" placeholder="Dejar en blanco para no cambiar" value={llaveFirma} onChange={(e) => setLlaveFirma(e.target.value)} className="campo" autoComplete="new-password" />
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button type="submit" className="boton boton-primario">Guardar cambios</button>
              </div>
            </form>
          </section>
        )}

        {/* =================== USUARIOS =================== */}
        {pestana === "usuarios" && (
          <section className="tarjeta aparecer overflow-hidden">
            <div className="seccion-titulo">
              <span className="icono-caja bg-violet-50 text-violet-700">
                <IconoUsuario className="size-5" />
              </span>
              <div className="flex-1">
                <h2 className="font-semibold text-slate-900">Usuarios</h2>
                <p className="text-sm text-slate-500">Quién puede entrar al sistema y con qué permisos</p>
              </div>
              <button onClick={() => setMostrarFormUsuario((v) => !v)} className="boton boton-primario boton-chico" aria-expanded={mostrarFormUsuario}>
                <IconoMas className="size-4" />
                Nuevo usuario
              </button>
            </div>

            {mostrarFormUsuario && (
              <form onSubmit={crearUsuario} className="flex flex-wrap items-end gap-3 border-b border-slate-100 bg-slate-50/60 p-5">
                <div>
                  <label className="etiqueta" htmlFor="u-nombre">Usuario</label>
                  <input id="u-nombre" required minLength={3} maxLength={25} placeholder="Nombre de usuario" value={nuevoUsuario.nombre_usuario} onChange={(e) => setNuevoUsuario({ ...nuevoUsuario, nombre_usuario: e.target.value })} className="campo !w-48" autoComplete="off" />
                </div>
                <div>
                  <label className="etiqueta" htmlFor="u-clave">Contraseña</label>
                  <input id="u-clave" required minLength={8} type="password" placeholder="8+ con mayúscula, minúscula y número" value={nuevoUsuario.password} onChange={(e) => setNuevoUsuario({ ...nuevoUsuario, password: e.target.value })} className="campo !w-48" autoComplete="new-password" />
                </div>
                <div>
                  <label className="etiqueta" htmlFor="u-rol">Rol</label>
                  <select id="u-rol" value={nuevoUsuario.nombre_rol} onChange={(e) => setNuevoUsuario({ ...nuevoUsuario, nombre_rol: e.target.value })} className="campo !w-40">
                    <option value="CAJERO">Cajero</option>
                    <option value="GERENTE">Gerente (solo consulta)</option>
                    <option value="ADMIN">Administrador</option>
                  </select>
                </div>
                <button type="submit" className="boton boton-primario">Crear usuario</button>
              </form>
            )}

            <div className="overflow-x-auto">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Rol</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {usuarios.map((u) => {
                    const soyYo = u.nombre_usuario === yo;
                    return (
                      <tr key={u.id_usuario} className={u.activo ? undefined : "opacity-60"}>
                        <td>
                          <div className="flex items-center gap-3">
                            <span className="grid size-9 place-items-center rounded-full bg-violet-50 text-sm font-bold text-violet-700">
                              {u.nombre_usuario.charAt(0).toUpperCase()}
                            </span>
                            <span className="font-semibold text-slate-900">{u.nombre_usuario}</span>
                            {soyYo && <span className="chip chip-info">Tú</span>}
                          </div>
                        </td>
                        <td>
                          <select
                            value={u.rol.nombre_rol}
                            disabled={soyYo}
                            onChange={(e) => actualizarUsuario(u, { nombre_rol: e.target.value }, `${u.nombre_usuario} ahora es ${e.target.value === "ADMIN" ? "administrador" : e.target.value === "GERENTE" ? "gerente" : "cajero"}`)}
                            className="campo !w-44 !py-1.5"
                            aria-label={`Rol de ${u.nombre_usuario}`}
                          >
                            <option value="CAJERO">Cajero</option>
                            <option value="GERENTE">Gerente (solo consulta)</option>
                            <option value="ADMIN">Administrador</option>
                          </select>
                        </td>
                        <td>
                          <span className={`chip ${u.activo ? "chip-ok" : "chip-neutro"}`}>{u.activo ? "Activo" : "Inactivo"}</span>
                        </td>
                        <td className="whitespace-nowrap text-right">
                          <button onClick={() => setClave({ usuario: u, valor: "" })} className="boton boton-texto boton-chico">
                            <IconoLlave className="size-4" />
                            Contraseña
                          </button>
                          {!soyYo && (
                            <button
                              onClick={() => actualizarUsuario(u, { activo: !u.activo }, `${u.nombre_usuario} ${u.activo ? "desactivado" : "reactivado"}`)}
                              className={`boton boton-texto boton-chico ${u.activo ? "text-red-600 hover:!bg-red-50" : ""}`}
                            >
                              {u.activo ? "Desactivar" : "Reactivar"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
              Un usuario desactivado no puede entrar, pero sus facturas y movimientos se conservan. Siempre debe quedar un administrador activo.
            </p>
          </section>
        )}

        {/* =================== SERIES =================== */}
        {pestana === "series" && (
          <section className="tarjeta aparecer overflow-hidden">
            <div className="seccion-titulo">
              <span className="icono-caja bg-sky-50 text-sky-700">
                <IconoFactura className="size-5" />
              </span>
              <div className="flex-1">
                <h2 className="font-semibold text-slate-900">Series de facturación</h2>
                <p className="text-sm text-slate-500">Cada serie lleva su propio número consecutivo</p>
              </div>
              <button onClick={() => setMostrarFormSerie((v) => !v)} className="boton boton-primario boton-chico" aria-expanded={mostrarFormSerie}>
                <IconoMas className="size-4" />
                Nueva serie
              </button>
            </div>

            {mostrarFormSerie && (
              <form onSubmit={crearSerie} className="flex flex-wrap items-end gap-3 border-b border-slate-100 bg-slate-50/60 p-5">
                <div>
                  <label className="etiqueta" htmlFor="s-tipo">Tipo</label>
                  <select id="s-tipo" value={nuevaSerie.tipo_documento} onChange={(e) => setNuevaSerie({ ...nuevaSerie, tipo_documento: e.target.value })} className="campo !w-48">
                    <option value="FACT">Factura (FACT)</option>
                    <option value="NCRE">Nota de crédito (NCRE)</option>
                  </select>
                </div>
                <div>
                  <label className="etiqueta" htmlFor="s-serie">Serie</label>
                  <input id="s-serie" required maxLength={10} placeholder="Ej. B" value={nuevaSerie.serie} onChange={(e) => setNuevaSerie({ ...nuevaSerie, serie: e.target.value.toUpperCase() })} className="campo !w-28 uppercase" />
                </div>
                <button type="submit" className="boton boton-primario">Agregar serie</button>
              </form>
            )}

            <div className="overflow-x-auto">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Serie</th>
                    <th className="num">Último número usado</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {series.map((s) => (
                    <tr key={s.id_serie} className={s.activa ? undefined : "opacity-60"}>
                      <td>
                        <span className={`chip ${s.tipo_documento === "FACT" ? "chip-marca" : "chip-aviso"}`}>
                          {s.tipo_documento === "FACT" ? "Factura" : "Nota de crédito"}
                        </span>
                      </td>
                      <td className="font-semibold text-slate-900">{s.serie}</td>
                      <td className="num">{s.correlativo}</td>
                      <td>
                        <span className={`chip ${s.activa ? "chip-ok" : "chip-neutro"}`}>{s.activa ? "Activa" : "Desactivada"}</span>
                      </td>
                      <td className="text-right">
                        <button
                          onClick={() => cambiarSerie(s, !s.activa)}
                          className={`boton boton-texto boton-chico ${s.activa ? "text-red-600 hover:!bg-red-50" : ""}`}
                        >
                          {s.activa ? "Desactivar" : "Activar"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
              Una serie desactivada deja de ofrecerse en el punto de venta, pero conserva su historial. Debe quedar al menos una serie de facturas activa.
            </p>
          </section>
        )}
      </main>

      {/* ---------- Restablecer contraseña ---------- */}
      {clave && (
        <div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm"
          onMouseDown={(e) => e.target === e.currentTarget && setClave(null)}
        >
          <form onSubmit={restablecerClave} className="tarjeta aparecer w-full max-w-md p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="titulo-clave">
            <h2 id="titulo-clave" className="text-lg font-bold text-slate-900">
              Restablecer contraseña
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Nueva contraseña para <strong>{clave.usuario.nombre_usuario}</strong>. Avísale para que la cambie en su primer ingreso.
            </p>
            <label className="etiqueta mt-4" htmlFor="nueva-clave">Nueva contraseña</label>
            <input
              id="nueva-clave"
              type="password"
              required
              minLength={8}
              autoFocus
              value={clave.valor}
              onChange={(e) => setClave({ ...clave, valor: e.target.value })}
              className="campo"
              placeholder="8+ con mayúscula, minúscula y número"
              autoComplete="new-password"
            />
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setClave(null)} className="boton boton-secundario">
                Cancelar
              </button>
              <button type="submit" disabled={clave.valor.length < 8} className="boton boton-primario">
                Guardar contraseña
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
