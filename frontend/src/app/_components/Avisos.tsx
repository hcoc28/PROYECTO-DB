"use client";

// ============================================================
// COMPONENTE — notificaciones emergentes
// Se monta una sola vez en el layout. Muestra hasta 4 avisos
// apilados abajo a la derecha; cada uno se cierra solo (se
// detiene mientras el cursor o el teclado están sobre él) o con
// la X. Los errores se anuncian como alerta a los lectores de
// pantalla; los demás, como estado.
// ============================================================

import { useEffect, useState } from "react";
import { suscribirAvisos, type Aviso, type TipoAviso } from "@/lib/client/avisos";
import { IconoAlerta, IconoCampana, IconoCerrar, IconoCheck } from "./iconos";

const MAXIMO = 4;

const ESTILO: Record<TipoAviso, string> = {
  ok: "alerta-ok",
  error: "alerta-error",
  aviso: "alerta-aviso",
  info: "border-sky-200 bg-sky-50 text-sky-900",
};

function Icono({ tipo }: { tipo: TipoAviso }) {
  if (tipo === "ok") return <IconoCheck className="mt-0.5 size-4 shrink-0" />;
  if (tipo === "info") return <IconoCampana className="mt-0.5 size-4 shrink-0" />;
  return <IconoAlerta className="mt-0.5 size-4 shrink-0" />;
}

function Tarjeta({ aviso, onCerrar }: { aviso: Aviso; onCerrar: () => void }) {
  const [pausado, setPausado] = useState(false);

  useEffect(() => {
    if (pausado) return;
    const t = setTimeout(onCerrar, aviso.duracion);
    return () => clearTimeout(t);
  }, [pausado, aviso.duracion, onCerrar]);

  return (
    <div
      role={aviso.tipo === "error" ? "alert" : "status"}
      className={`alerta aparecer pointer-events-auto shadow-lg ${ESTILO[aviso.tipo]}`}
      onMouseEnter={() => setPausado(true)}
      onMouseLeave={() => setPausado(false)}
      onFocus={() => setPausado(true)}
      onBlur={() => setPausado(false)}
    >
      <Icono tipo={aviso.tipo} />
      <div className="min-w-0 flex-1">
        {aviso.titulo && <p className="font-semibold">{aviso.titulo}</p>}
        <p className={aviso.titulo ? "mt-0.5" : "font-medium"}>{aviso.texto}</p>
      </div>
      <button onClick={onCerrar} aria-label="Cerrar notificación" className="rounded-md p-0.5 opacity-70 transition hover:opacity-100">
        <IconoCerrar className="size-4" />
      </button>
    </div>
  );
}

export default function Avisos() {
  const [lista, setLista] = useState<Aviso[]>([]);

  useEffect(
    () => suscribirAvisos((a) => setLista((actual) => [...actual, a].slice(-MAXIMO))),
    []
  );

  return (
    <div
      role="region"
      className="no-imprimir pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      aria-label="Notificaciones"
    >
      {lista.map((a) => (
        <Tarjeta key={a.id} aviso={a} onCerrar={() => setLista((actual) => actual.filter((x) => x.id !== a.id))} />
      ))}
    </div>
  );
}
