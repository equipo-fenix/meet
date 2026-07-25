'use client';

/**
 * PanelShell — El marco de los paneles del costado
 *
 * Chat y Participantes son cosas distintas, pero si cada uno tiene su propio
 * borde, su propio título y su propia X, al abrirlos uno detrás de otro la
 * pantalla salta. Comparten marco para que cambiar de panel se sienta como
 * cambiar de pestaña, no como abrir otra ventana.
 */

import React from 'react';

export const ORO = '#C9A84C';

interface PanelShellProps {
  titulo: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Barra fija abajo del panel. Sin ella el panel termina donde termina. */
  pie?: React.ReactNode;
}

export function PanelShell({ titulo, onClose, children, pie }: PanelShellProps) {
  return (
    <div
      className="fenix-panel"
      style={{
        width: '320px',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid rgba(255,255,255,0.08)',
        background: '#16161f',
        overflow: 'hidden',
      }}
    >
      {/* Cabecera */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '11px 14px',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#fff' }}>{titulo}</span>
        <button
          onClick={onClose}
          title="Cerrar"
          aria-label="Cerrar panel"
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.5)',
            cursor: 'pointer',
            fontSize: '17px',
            lineHeight: 1,
            padding: '2px 6px',
          }}
        >
          ✕
        </button>
      </div>

      {/* Cuerpo */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>

      {/* Pie */}
      {pie && (
        <div
          style={{
            flexShrink: 0,
            padding: '10px 12px',
            borderTop: '1px solid rgba(255,255,255,0.07)',
            background: 'rgba(0,0,0,0.2)',
          }}
        >
          {pie}
        </div>
      )}
    </div>
  );
}
